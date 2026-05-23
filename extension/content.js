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
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-reel-shelf-renderer",
    "ytd-reel-item-renderer",
    "ytd-radio-renderer",
    "ytd-playlist-renderer",
    "ytd-compact-radio-renderer",
    "ytd-compact-playlist-renderer",
  ].join(", ");

  function getVideoIdFromCard(card) {
    var link =
      card.querySelector("a#video-title-link") ||
      card.querySelector("a#video-title") ||
      card.querySelector("a.yt-simple-endpoint[href*='watch']") ||
      card.querySelector('a[href*="/shorts/"]') ||
      card.querySelector("a[href*='/playlist']");
    if (!link) return null;

    var href = link.getAttribute("href") || "";
    var match = href.match(/[?&]v=([^&]+)/) || href.match(/\/shorts\/([^?&/]+)/);
    return match ? match[1] : null;
  }

  function extractTitleFromCard(card) {
    var el =
      card.querySelector("#video-title") ||
      card.querySelector("a#video-title-link") ||
      card.querySelector("h3 #video-title") ||
      card.querySelector("h3 a") ||
      card.querySelector("span#video-title") ||
      card.querySelector("[id='video-title']");

    if (!el) return "";

    var title = (
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).trim();

    // If we got a title from the element, use it
    if (title) return title;

    // Last resort: check aria-label on the card's main link
    var mainLink = card.querySelector("a[aria-label]");
    if (mainLink) {
      return (mainLink.getAttribute("aria-label") || "").trim();
    }

    return "";
  }

  function extractChannelFromCard(card) {
    var el =
      card.querySelector("ytd-channel-name a") ||
      card.querySelector("ytd-channel-name yt-formatted-string") ||
      card.querySelector("ytd-channel-name #text") ||
      card.querySelector("#channel-name a") ||
      card.querySelector("#channel-name yt-formatted-string") ||
      card.querySelector("#channel-name #text") ||
      card.querySelector("div.ytd-channel-name") ||
      card.querySelector("#byline a") ||
      card.querySelector("#byline") ||
      card.querySelector(".ytd-video-meta-block a.yt-simple-endpoint[href*='/@']") ||
      card.querySelector("a.yt-simple-endpoint[href*='/@']");

    if (!el) return "";

    return (
      el.innerText ||
      el.textContent ||
      el.getAttribute("aria-label") ||
      ""
    ).trim();
  }

  function applyFiltersToDOM() {
    if (!enabled) return;

    var cards = document.querySelectorAll(CARD_SELECTORS);
    for (var i = 0; i < cards.length; i++) {
      processCard(cards[i]);
    }
  }

  function processCard(card) {
    if (!enabled) {
      showCard(card);
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

    // Link points to /shorts/
    if (card.querySelector('a[href*="/shorts/"]')) {
      return true;
    }

    // Overlay badge says "SHORTS" or the Shorts icon is present
    var overlayText = card.querySelector("[overlay-style='SHORTS']") ||
                      card.querySelector("ytd-thumbnail-overlay-time-status-renderer[overlay-style='SHORTS']");
    if (overlayText) {
      return true;
    }

    // Check aria-label or overlay text for "Shorts" indicator
    var badges = card.querySelectorAll("ytd-thumbnail-overlay-time-status-renderer");
    for (var b = 0; b < badges.length; b++) {
      var badgeText = (badges[b].innerText || badges[b].textContent || "").trim().toUpperCase();
      if (badgeText === "SHORTS" || badgeText === "SHORT") {
        return true;
      }
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
    // Reset all cards, then re-evaluate with current preferences
    var cards = document.querySelectorAll(CARD_SELECTORS);
    feedItemsHidden = 0;
    for (var i = 0; i < cards.length; i++) {
      cards[i].style.display = "";
      delete cards[i].dataset.algocontrolHidden;
      delete cards[i].dataset.algocontrolReason;
    }
    applyFiltersToDOM();
    console.log("[AlgoControl] Reprocessed " + cards.length + " cards with updated preferences");
  }

  // --- Watch for new cards (infinite scroll / SPA navigation) ---
  function observeFeed() {
    var observer = new MutationObserver(function (mutations) {
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
        }
      }
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

  console.log("[AlgoControl] Content script loaded — waiting for feed data");
})();
