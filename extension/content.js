// content.js — runs in ISOLATED world (has chrome.* APIs)
// Receives intercepted feed data, applies filters, manipulates DOM

(function () {
  "use strict";

  // --- State ---
  var feedItemsReceived = 0;
  var feedItemsHidden = 0;
  var enabled = true;
  var blockedKeywords = [];
  var blockedChannels = [];
  var hideShorts = false;

  // --- Load preferences ---
  function loadPreferences() {
    return chrome.storage.local.get({
      enabled: true,
      blockedKeywords: [],
      blockedChannels: [],
      hideShorts: false,
    }).then(function (prefs) {
      enabled = prefs.enabled;
      blockedKeywords = prefs.blockedKeywords.map(function (k) {
        return k.toLowerCase().trim();
      }).filter(Boolean);
      blockedChannels = prefs.blockedChannels.map(function (c) {
        return c.toLowerCase().trim();
      }).filter(Boolean);
      hideShorts = prefs.hideShorts;
      console.log("[AlgoControl] Preferences loaded:", {
        enabled: enabled,
        blockedKeywords: blockedKeywords,
        blockedChannels: blockedChannels,
        hideShorts: hideShorts,
      });
    });
  }

  // Reload preferences when they change
  chrome.storage.onChanged.addListener(function () {
    loadPreferences().then(function () {
      reprocessAllCards();
    });
  });

  // --- Extract video data from YouTube API response ---
  function extractVideoRenderers(obj, results) {
    if (!results) results = [];
    if (!obj || typeof obj !== "object") return results;

    // Standard video cards (homepage, search, channel pages)
    if (obj.videoRenderer) {
      var vr = obj.videoRenderer;
      results.push({
        videoId: vr.videoId || "",
        title: extractText(vr.title),
        channel: extractText(vr.ownerText || vr.longBylineText || vr.shortBylineText),
        duration: extractText(vr.lengthText),
        isShort: !vr.lengthText || isShortDuration(extractText(vr.lengthText)),
      });
    }

    // Sidebar recommendation videos (watch page)
    if (obj.compactVideoRenderer) {
      var cvr = obj.compactVideoRenderer;
      results.push({
        videoId: cvr.videoId || "",
        title: extractText(cvr.title),
        channel: extractText(cvr.longBylineText || cvr.shortBylineText || cvr.ownerText),
        duration: extractText(cvr.lengthText),
        isShort: !cvr.lengthText || isShortDuration(extractText(cvr.lengthText)),
      });
    }

    // Playlist/Mix items in recommendations
    if (obj.playlistVideoRenderer) {
      var pvr = obj.playlistVideoRenderer;
      results.push({
        videoId: pvr.videoId || "",
        title: extractText(pvr.title),
        channel: extractText(pvr.longBylineText || pvr.shortBylineText),
        duration: extractText(pvr.lengthText),
        isShort: false,
      });
    }

    // Shorts (reels)
    if (obj.reelItemRenderer) {
      var rr = obj.reelItemRenderer;
      results.push({
        videoId: rr.videoId || "",
        title: extractText(rr.headline),
        channel: extractText(rr.ownerText),
        duration: "",
        isShort: true,
      });
    }

    // Shorts shelf container — mark all children as shorts
    if (obj.reelShelfRenderer) {
      var shelf = obj.reelShelfRenderer;
      var items = shelf.items || [];
      for (var s = 0; s < items.length; s++) {
        if (items[s].reelItemRenderer) {
          var ri = items[s].reelItemRenderer;
          results.push({
            videoId: ri.videoId || "",
            title: extractText(ri.headline),
            channel: extractText(ri.ownerText),
            duration: "",
            isShort: true,
          });
        }
      }
    }

    // Inline Shorts in search results (shortsLockupViewModel)
    if (obj.shortsLockupViewModel) {
      var slvm = obj.shortsLockupViewModel;
      results.push({
        videoId: (slvm.onTap && slvm.onTap.innertubeCommand &&
                  slvm.onTap.innertubeCommand.reelWatchEndpoint &&
                  slvm.onTap.innertubeCommand.reelWatchEndpoint.videoId) || "",
        title: (slvm.overlayMetadata && slvm.overlayMetadata.primaryText &&
                slvm.overlayMetadata.primaryText.content) || "",
        channel: "",
        duration: "",
        isShort: true,
      });
    }

    // Recurse into child objects/arrays
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      // Skip keys we already handled to avoid duplicate extraction
      if (key === "videoRenderer" || key === "compactVideoRenderer" ||
          key === "playlistVideoRenderer" || key === "reelItemRenderer" ||
          key === "reelShelfRenderer" || key === "shortsLockupViewModel") {
        continue;
      }
      var val = obj[key];
      if (Array.isArray(val)) {
        for (var j = 0; j < val.length; j++) {
          extractVideoRenderers(val[j], results);
        }
      } else if (typeof val === "object" && val !== null) {
        extractVideoRenderers(val, results);
      }
    }

    return results;
  }

  function extractText(textObj) {
    if (!textObj) return "";
    if (typeof textObj === "string") return textObj;
    if (textObj.simpleText) return textObj.simpleText;
    if (textObj.content) return textObj.content;
    if (textObj.runs) {
      return textObj.runs
        .map(function (r) { return r.text; })
        .join("");
    }
    return "";
  }

  function isShortDuration(durationStr) {
    if (!durationStr) return false;
    // Shorts are typically under 60 seconds: "0:30", "0:58" etc.
    var match = durationStr.match(/^(\d+):(\d+)$/);
    if (match) {
      var minutes = parseInt(match[1], 10);
      var seconds = parseInt(match[2], 10);
      return minutes === 0 && seconds <= 60;
    }
    return false;
  }

  // --- Decide whether a video should be hidden (always uses CURRENT preferences) ---
  function shouldHideVideo(video) {
    if (!enabled) return { hide: false, reason: "" };

    if (hideShorts && video.isShort) {
      return { hide: true, reason: "Short video filtered" };
    }

    var titleLower = video.title.toLowerCase();
    for (var i = 0; i < blockedKeywords.length; i++) {
      if (blockedKeywords[i] && titleLower.includes(blockedKeywords[i])) {
        return { hide: true, reason: 'Keyword: "' + blockedKeywords[i] + '"' };
      }
    }

    var channelLower = video.channel.toLowerCase();
    for (var j = 0; j < blockedChannels.length; j++) {
      if (blockedChannels[j] && channelLower.includes(blockedChannels[j])) {
        return { hide: true, reason: 'Channel: "' + blockedChannels[j] + '"' };
      }
    }

    return { hide: false, reason: "" };
  }

  // --- Build a lookup map from intercepted data ---
  var videoDataMap = {};

  function processInterceptedData(data) {
    var videos = extractVideoRenderers(data);
    feedItemsReceived += videos.length;

    for (var i = 0; i < videos.length; i++) {
      var video = videos[i];
      if (video.videoId) {
        // Store video data only — decisions are evaluated live, not cached
        videoDataMap[video.videoId] = video;
      }
    }

    console.log(
      "[AlgoControl] Processed " + videos.length + " videos from API. " +
      "Total tracked: " + Object.keys(videoDataMap).length
    );

    applyFiltersToDOM();
    updateBadge();
  }

  // --- DOM manipulation ---
  var CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "yt-lockup-view-model",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-reel-shelf-renderer",
    "ytd-reel-item-renderer",
    "ytd-rich-shelf-renderer",
    "ytd-radio-renderer",
    "ytd-playlist-renderer",
    "ytd-compact-radio-renderer",
    "ytd-compact-playlist-renderer",
  ].join(", ");

  function getVideoIdFromCard(card) {
    // Method 1: extract from content-id class (yt-lockup-view-model)
    var contentDiv = card.querySelector("[class*='content-id-']") || card;
    var classList = contentDiv.className || "";
    var classMatch = classList.match(/content-id-([a-zA-Z0-9_-]+)/);
    if (classMatch) return classMatch[1];

    // Method 2: find any link with a video ID
    var link =
      card.querySelector("a#video-title-link") ||
      card.querySelector("a#video-title") ||
      card.querySelector('a[href*="/watch?v="]') ||
      card.querySelector('a[href*="/shorts/"]') ||
      card.querySelector("a[href*='/playlist']");
    if (!link) return null;

    var href = link.getAttribute("href") || "";
    var match = href.match(/[?&]v=([^&]+)/) || href.match(/\/shorts\/([^?&/]+)/);
    return match ? match[1] : null;
  }

  function extractTitleFromCard(card) {
    // Try selectors from most specific to most generic
    var el =
      card.querySelector("#video-title") ||
      card.querySelector("a#video-title-link") ||
      card.querySelector("h3 a") ||
      card.querySelector("h3") ||
      card.querySelector("span#video-title");

    if (el) {
      var title = (
        el.getAttribute("title") ||
        el.innerText ||
        el.textContent ||
        ""
      ).trim();
      if (title) return title;
    }

    // Fallback: any link with a title attribute
    var titled = card.querySelector('a[title]');
    if (titled) {
      var t = (titled.getAttribute("title") || "").trim();
      if (t) return t;
    }

    // Last resort: aria-label on a link
    var labeled = card.querySelector("a[aria-label]");
    if (labeled) {
      return (labeled.getAttribute("aria-label") || "").trim();
    }

    return "";
  }

  function extractChannelFromCard(card) {
    // Most reliable: any link pointing to a channel page (/@username)
    // This works across ALL YouTube component types
    var channelLink = card.querySelector('a[href*="/@"]');
    if (channelLink) {
      var text = (channelLink.innerText || channelLink.textContent || "").trim();
      if (text) return text;
    }

    // Legacy selectors for older YouTube components
    var el =
      card.querySelector("ytd-channel-name a") ||
      card.querySelector("ytd-channel-name yt-formatted-string") ||
      card.querySelector("#channel-name a") ||
      card.querySelector("#channel-name") ||
      card.querySelector("#byline a") ||
      card.querySelector("#byline");

    if (!el) return "";

    return (
      el.innerText ||
      el.textContent ||
      ""
    ).trim();
  }

  function applyFiltersToDOM() {
    if (!enabled) return;

    var cards = document.querySelectorAll(CARD_SELECTORS);
    for (var i = 0; i < cards.length; i++) {
      processCard(cards[i]);
    }

    if (hideShorts) {
      hideShortsShelves();
    }
  }

  // Only inherently-Shorts shelves are safe to hide via walk-up. The main
  // search/home results list is itself a YTD-ITEM-SECTION-RENDERER, so we must
  // NOT stop there — that's reached only via the exact-title guard below.
  var SHELF_CONTAINER_TAGS = {
    "YTD-SHELF-RENDERER": true,
    "YTD-RICH-SHELF-RENDERER": true,
    "YTD-REEL-SHELF-RENDERER": true,
  };

  function hideShortsShelves() {
    var hiddenContainers = [];

    function hideNearestShelf(node) {
      var parent = node.parentElement;
      for (var depth = 0; depth < 12 && parent; depth++) {
        if (SHELF_CONTAINER_TAGS[parent.tagName]) {
          if (hiddenContainers.indexOf(parent) === -1) {
            hideCard(parent, "Shorts shelf hidden");
            hiddenContainers.push(parent);
          }
          return;
        }
        parent = parent.parentElement;
      }
    }

    // 1. Walk up from Shorts lockups to their dedicated shelf container.
    //    (Not /shorts/ links — those match inline result thumbnails too.)
    var seeds = document.querySelectorAll(
      "ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2"
    );
    for (var i = 0; i < seeds.length; i++) {
      hideNearestShelf(seeds[i]);
    }

    // 2. Section-level detection for ytd-item-section-renderer.
    //    A section is a pure Shorts shelf if it contains ytm-shorts-lockup-view-model
    //    but does NOT contain yt-lockup-view-model (regular videos).
    //    Mixed sections (regular results that happen to have inline shorts links)
    //    contain both — those must not be hidden.
    var sections = document.querySelectorAll("ytd-item-section-renderer");
    for (var s = 0; s < sections.length; s++) {
      if (hiddenContainers.indexOf(sections[s]) !== -1) continue;
      var hasShortsLockup = !!sections[s].querySelector("ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2");
      var hasRegularVideo = !!sections[s].querySelector("yt-lockup-view-model, ytd-video-renderer, ytd-compact-video-renderer");
      if (hasShortsLockup && !hasRegularVideo) {
        hideCard(sections[s], "Shorts shelf hidden (section)");
        hiddenContainers.push(sections[s]);
        continue;
      }
      // Fallback: h2 header exactly says "Shorts" (catches other shelf layouts)
      var h2El = sections[s].querySelector("h2");
      var h2Text = h2El ? (h2El.innerText || h2El.textContent || "").trim().toLowerCase() : "";
      if (h2Text === "shorts") {
        hideCard(sections[s], "Shorts shelf hidden (h2)");
        hiddenContainers.push(sections[s]);
      }
    }

    // 3. Title-based detection for non-item-section shelf types.
    var otherShelves = document.querySelectorAll(
      "ytd-shelf-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer"
    );
    for (var r = 0; r < otherShelves.length; r++) {
      if (hiddenContainers.indexOf(otherShelves[r]) !== -1) continue;
      var shelfH2 = otherShelves[r].querySelector("h2, #title, yt-formatted-string#title");
      var shelfTitle = shelfH2 ? (shelfH2.innerText || shelfH2.textContent || "").trim().toLowerCase() : "";
      if (shelfTitle === "shorts" ||
          !!otherShelves[r].querySelector("ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2")) {
        hideCard(otherShelves[r], "Shorts shelf hidden (other)");
        hiddenContainers.push(otherShelves[r]);
      }
    }
  }

  function processCard(card) {
    if (!enabled) {
      showCard(card);
      return;
    }

    // Skip yt-lockup-view-model if it's inside ytd-rich-item-renderer
    // (the parent will handle it — hiding the child leaves an empty shell)
    if (card.tagName === "YT-LOCKUP-VIEW-MODEL" &&
        card.closest("ytd-rich-item-renderer")) {
      return;
    }

    var videoId = getVideoIdFromCard(card);
    var decision = null;

    // If we have intercepted API data, evaluate with CURRENT preferences
    if (videoId && videoDataMap[videoId]) {
      decision = shouldHideVideo(videoDataMap[videoId]);
      if (decision.hide) {
        hideCard(card, decision.reason);
        return;
      }
    }

    // DOM fallback: extract text directly from rendered elements
    var title = extractTitleFromCard(card);
    var channel = extractChannelFromCard(card);

    // Keyword check
    var titleLower = title.toLowerCase();
    for (var i = 0; i < blockedKeywords.length; i++) {
      if (blockedKeywords[i] && titleLower.includes(blockedKeywords[i])) {
        hideCard(card, 'Keyword: "' + blockedKeywords[i] + '"');
        return;
      }
    }

    // Channel check
    var channelLower = channel.toLowerCase();
    for (var j = 0; j < blockedChannels.length; j++) {
      if (blockedChannels[j] && channelLower.includes(blockedChannels[j])) {
        hideCard(card, 'Channel: "' + blockedChannels[j] + '"');
        return;
      }
    }

    // Shorts check (DOM-level detection)
    if (hideShorts) {
      if (isCardAShort(card)) {
        hideCard(card, "Short video filtered");
        return;
      }
    }

    // Playlist/Mix keyword + channel check
    if (card.tagName === "YTD-RADIO-RENDERER" ||
        card.tagName === "YTD-PLAYLIST-RENDERER" ||
        card.tagName === "YTD-COMPACT-RADIO-RENDERER" ||
        card.tagName === "YTD-COMPACT-PLAYLIST-RENDERER") {
      var playlistTitle = extractPlaylistTitle(card).toLowerCase();
      for (var p = 0; p < blockedKeywords.length; p++) {
        if (blockedKeywords[p] && playlistTitle.includes(blockedKeywords[p])) {
          hideCard(card, 'Keyword in playlist: "' + blockedKeywords[p] + '"');
          return;
        }
      }
      var playlistChannel = extractPlaylistChannel(card).toLowerCase();
      for (var q = 0; q < blockedChannels.length; q++) {
        if (blockedChannels[q] && playlistChannel.includes(blockedChannels[q])) {
          hideCard(card, 'Channel in playlist: "' + blockedChannels[q] + '"');
          return;
        }
      }
    }

    showCard(card);
  }

  function isCardAShort(card) {
    // Direct Shorts elements
    if (card.tagName === "YTD-REEL-SHELF-RENDERER" ||
        card.tagName === "YTD-REEL-ITEM-RENDERER") {
      return true;
    }

    // New YouTube Shorts components (ytm-shorts-lockup-view-model)
    if (card.querySelector("ytm-shorts-lockup-view-model") ||
        card.querySelector("ytm-shorts-lockup-view-model-v2")) {
      return true;
    }

    // Shelf containing Shorts (ytd-rich-shelf-renderer with Shorts inside)
    if (card.tagName === "YTD-RICH-SHELF-RENDERER" &&
        (card.querySelector("ytm-shorts-lockup-view-model") ||
         card.querySelector('a[href*="/shorts/"]'))) {
      return true;
    }

    // Any link points to /shorts/
    if (card.querySelector('a[href*="/shorts/"]')) {
      return true;
    }

    // Overlay badge attribute
    if (card.querySelector("[overlay-style='SHORTS']")) {
      return true;
    }

    // Badge text says "SHORTS"
    var badges = card.querySelectorAll(
      "ytd-thumbnail-overlay-time-status-renderer, badge-shape, yt-thumbnail-badge-view-model"
    );
    for (var b = 0; b < badges.length; b++) {
      var badgeText = (badges[b].innerText || badges[b].textContent || "").trim().toUpperCase();
      if (badgeText === "SHORTS" || badgeText === "SHORT") return true;
      var style = badges[b].getAttribute("overlay-style");
      if (style === "SHORTS") return true;
    }

    return false;
  }

  function extractPlaylistTitle(card) {
    var el =
      card.querySelector("#video-title") ||
      card.querySelector("a.yt-simple-endpoint span#video-title") ||
      card.querySelector("h3 a") ||
      card.querySelector("a[title]");
    if (!el) return "";
    return (el.getAttribute("title") || el.innerText || el.textContent || "").trim();
  }

  function extractPlaylistChannel(card) {
    var el =
      card.querySelector("yt-formatted-string.ytd-video-meta-block a") ||
      card.querySelector(".ytd-video-meta-block a[href*='/@']") ||
      card.querySelector("a[href*='/@']") ||
      card.querySelector("#byline");
    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  function hideCard(card, reason) {
    if (card.dataset.algocontrolHidden === "true") return;
    card.style.display = "none";
    card.dataset.algocontrolHidden = "true";
    card.dataset.algocontrolReason = reason || "";
    feedItemsHidden++;
    console.log("[AlgoControl] Hidden:", reason);
  }

  function showCard(card) {
    if (card.dataset.algocontrolHidden !== "true") return;
    card.style.display = "";
    delete card.dataset.algocontrolHidden;
    delete card.dataset.algocontrolReason;
  }

  function reprocessAllCards() {
    // Reset all cards AND Shorts shelf containers, then re-evaluate
    var allHidden = document.querySelectorAll("[data-algocontrol-hidden='true']");
    for (var h = 0; h < allHidden.length; h++) {
      allHidden[h].style.display = "";
      delete allHidden[h].dataset.algocontrolHidden;
      delete allHidden[h].dataset.algocontrolReason;
    }
    feedItemsHidden = 0;
    applyFiltersToDOM();
    console.log("[AlgoControl] Reprocessed with updated preferences");
  }

  // --- Watch for new cards (infinite scroll / SPA navigation) ---
  var _shortsShelfTimer = null;
  function scheduleShortsShelfCheck() {
    if (!hideShorts) return;
    if (_shortsShelfTimer) clearTimeout(_shortsShelfTimer);
    _shortsShelfTimer = setTimeout(function () {
      _shortsShelfTimer = null;
      hideShortsShelves();
    }, 300);
  }

  function observeFeed() {
    var observer = new MutationObserver(function (mutations) {
      var needsShortsCheck = false;
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType !== 1) continue;

          if (node.matches && node.matches(CARD_SELECTORS)) {
            processCard(node);
          }

          var inner = node.querySelectorAll
            ? node.querySelectorAll(CARD_SELECTORS)
            : [];
          for (var k = 0; k < inner.length; k++) {
            processCard(inner[k]);
          }

          // Any section-level element added means a Shorts shelf may have appeared
          if (node.tagName && (
            node.tagName === "YTD-ITEM-SECTION-RENDERER" ||
            node.tagName === "YTD-SECTION-LIST-RENDERER" ||
            node.tagName === "YTD-REEL-SHELF-RENDERER" ||
            node.tagName === "YTD-RICH-SHELF-RENDERER"
          )) {
            needsShortsCheck = true;
          }
        }
      }
      if (needsShortsCheck) scheduleShortsShelfCheck();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    console.log("[AlgoControl] DOM observer active — watching for new feed items");
  }

  // --- Badge counter ---
  function updateBadge() {
    chrome.runtime.sendMessage({
      type: "ALGOCONTROL_STATS",
      hidden: feedItemsHidden,
      total: feedItemsReceived,
    }).catch(function () {
      // popup not open, ignore
    });
  }

  // --- Listen for intercepted data from MAIN world ---
  window.addEventListener("message", function (event) {
    if (
      event.source !== window ||
      !event.data ||
      event.data.type !== "ALGOCONTROL_FEED_DATA"
    ) {
      return;
    }

    console.log(
      "[AlgoControl] Intercepted API response from:",
      event.data.endpoint
    );
    processInterceptedData(event.data.data);
  });

  // --- Listen for messages from popup ---
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg.type === "GET_STATS") {
      sendResponse({
        hidden: feedItemsHidden,
        total: feedItemsReceived,
        enabled: enabled,
        trackedVideos: Object.keys(videoDataMap).length,
      });
    }
  });

  // --- Init ---
  loadPreferences().then(function () {
    observeFeed();
    setTimeout(applyFiltersToDOM, 1500);
    setTimeout(applyFiltersToDOM, 4000);
  });

  // --- Diagnostic: expose scan function to window for debugging ---
  // Run algocontrolDiag() in DevTools console to see what YouTube elements exist
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "ALGOCONTROL_DIAG") {
      runDiagnostic();
    }
  });

  function runDiagnostic() {
    var allCustomElements = document.querySelectorAll("*");
    var tagCounts = {};
    var ytTags = {};

    for (var i = 0; i < allCustomElements.length; i++) {
      var tag = allCustomElements[i].tagName.toLowerCase();
      if (tag.startsWith("ytd-") || tag.startsWith("yt-")) {
        if (!ytTags[tag]) ytTags[tag] = 0;
        ytTags[tag]++;
      }
    }

    // Find all elements that contain video links
    var videoLinks = document.querySelectorAll('a[href*="watch?v="], a[href*="/shorts/"]');
    var cardParents = {};
    for (var v = 0; v < videoLinks.length; v++) {
      var parent = videoLinks[v];
      for (var depth = 0; depth < 8; depth++) {
        parent = parent.parentElement;
        if (!parent) break;
        var pTag = parent.tagName.toLowerCase();
        if (pTag.startsWith("ytd-") || pTag.startsWith("yt-")) {
          if (!cardParents[pTag]) {
            cardParents[pTag] = { count: 0, sample: null };
          }
          cardParents[pTag].count++;
          if (!cardParents[pTag].sample) {
            var titleEl = parent.querySelector("#video-title, [id='video-title'], h3 a, span#video-title");
            var channelEl = parent.querySelector("ytd-channel-name a, a[href*='/@'], #channel-name, #byline");
            cardParents[pTag].sample = {
              title: titleEl ? (titleEl.getAttribute("title") || titleEl.innerText || "").substring(0, 60) : "(no title found)",
              channel: channelEl ? (channelEl.innerText || "").substring(0, 40) : "(no channel found)",
              titleSelector: titleEl ? titleEl.tagName + "#" + (titleEl.id || "") + "." + (titleEl.className || "").substring(0, 30) : "NONE",
              channelSelector: channelEl ? channelEl.tagName + "#" + (channelEl.id || "") : "NONE",
            };
          }
          break;
        }
      }
    }

    // Find playlist/mix elements
    var playlistLinks = document.querySelectorAll('a[href*="list="]');
    var playlistParents = {};
    for (var p = 0; p < playlistLinks.length; p++) {
      var pp = playlistLinks[p];
      for (var d2 = 0; d2 < 8; d2++) {
        pp = pp.parentElement;
        if (!pp) break;
        var ppTag = pp.tagName.toLowerCase();
        if (ppTag.startsWith("ytd-")) {
          if (!playlistParents[ppTag]) playlistParents[ppTag] = 0;
          playlistParents[ppTag]++;
          break;
        }
      }
    }

    console.log("%c[AlgoControl DIAGNOSTIC]", "color: #3ea6ff; font-size: 14px; font-weight: bold;");
    console.log("%cPage:", "font-weight:bold", window.location.pathname);
    console.log("%cAll ytd-/yt- elements on page:", "font-weight:bold", ytTags);
    console.log("%cVideo card containers (parent of watch/shorts links):", "font-weight:bold", cardParents);
    console.log("%cPlaylist containers (parent of list= links):", "font-weight:bold", playlistParents);
    console.log("%cCurrently tracked by AlgoControl:", "font-weight:bold", Object.keys(videoDataMap).length, "videos");
    console.log("%cCards matching our selectors:", "font-weight:bold", document.querySelectorAll(CARD_SELECTORS).length);
  }

  console.log("[AlgoControl] Content script loaded — waiting for feed data");
  console.log("[AlgoControl] To run diagnostics, paste this in console: window.postMessage({type:'ALGOCONTROL_DIAG'}, '*')");
})();
