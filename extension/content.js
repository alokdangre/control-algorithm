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
  var whitelistedChannels = [];
  var hideShorts = false;
  var hideLiveStreams = false;
  var hidePremieres = false;
  var minDurationSec = 0;
  var maxDurationSec = 0;
  var channelSignals = {};   // { "Channel Name": integer in [-3, +3] }

  // --- Load preferences ---
  function loadPreferences() {
    return chrome.storage.local.get({
      enabled: true,
      blockedKeywords: [],
      blockedChannels: [],
      whitelistedChannels: [],
      hideShorts: false,
      hideLiveStreams: false,
      hidePremieres: false,
      minDurationSec: 0,
      maxDurationSec: 0,
      channelSignals: {},
    }).then(function (prefs) {
      enabled = prefs.enabled;
      blockedKeywords = prefs.blockedKeywords.map(function (k) {
        return k.toLowerCase().trim();
      }).filter(Boolean);
      blockedChannels = prefs.blockedChannels.map(function (c) {
        return c.toLowerCase().trim();
      }).filter(Boolean);
      whitelistedChannels = prefs.whitelistedChannels.map(function (c) {
        return c.toLowerCase().trim();
      }).filter(Boolean);
      hideShorts = prefs.hideShorts;
      hideLiveStreams = prefs.hideLiveStreams;
      hidePremieres = prefs.hidePremieres;
      minDurationSec = prefs.minDurationSec || 0;
      maxDurationSec = prefs.maxDurationSec || 0;
      channelSignals = prefs.channelSignals || {};
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

    if (obj.videoRenderer) {
      var vr = obj.videoRenderer;
      var isLive = false;
      var isPremiere = false;
      var badgeList = (vr.badges || []).concat(vr.ownerBadges || []);
      for (var b = 0; b < badgeList.length; b++) {
        var bStyle = badgeList[b].metadataBadgeRenderer &&
                     badgeList[b].metadataBadgeRenderer.style || "";
        if (badgeList[b].liveBadgeRenderer || bStyle.indexOf("LIVE") !== -1) {
          isLive = true;
        }
      }
      if (vr.upcomingEventData) isPremiere = true;
      results.push({
        videoId: vr.videoId || "",
        title: extractText(vr.title),
        channel: extractText(vr.ownerText || vr.longBylineText || vr.shortBylineText),
        duration: extractText(vr.lengthText),
        isShort: !vr.lengthText || isShortDuration(extractText(vr.lengthText)),
        isLive: isLive,
        isPremiere: isPremiere,
      });
    }

    if (obj.compactVideoRenderer) {
      var cvr = obj.compactVideoRenderer;
      var cIsLive = !!(cvr.badges && cvr.badges.some &&
        cvr.badges.some(function(b) { return b.liveBadgeRenderer; }));
      results.push({
        videoId: cvr.videoId || "",
        title: extractText(cvr.title),
        channel: extractText(cvr.longBylineText || cvr.shortBylineText || cvr.ownerText),
        duration: extractText(cvr.lengthText),
        isShort: !cvr.lengthText || isShortDuration(extractText(cvr.lengthText)),
        isLive: cIsLive,
        isPremiere: false,
      });
    }

    if (obj.playlistVideoRenderer) {
      var pvr = obj.playlistVideoRenderer;
      results.push({
        videoId: pvr.videoId || "",
        title: extractText(pvr.title),
        channel: extractText(pvr.longBylineText || pvr.shortBylineText),
        duration: extractText(pvr.lengthText),
        isShort: false,
        isLive: false,
        isPremiere: false,
      });
    }

    if (obj.reelItemRenderer) {
      var rr = obj.reelItemRenderer;
      results.push({
        videoId: rr.videoId || "",
        title: extractText(rr.headline),
        channel: extractText(rr.ownerText),
        duration: "",
        isShort: true,
        isLive: false,
        isPremiere: false,
      });
    }

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
            isLive: false,
            isPremiere: false,
          });
        }
      }
    }

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
        isLive: false,
        isPremiere: false,
      });
    }

    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
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
      return textObj.runs.map(function (r) { return r.text; }).join("");
    }
    return "";
  }

  function isShortDuration(durationStr) {
    if (!durationStr) return false;
    var match = durationStr.match(/^(\d+):(\d+)$/);
    if (match) {
      var minutes = parseInt(match[1], 10);
      var seconds = parseInt(match[2], 10);
      return minutes === 0 && seconds <= 60;
    }
    return false;
  }

  // Parse "H:MM:SS" or "M:SS" to total seconds. Returns null if unparseable.
  function parseDurationSec(durationStr) {
    if (!durationStr) return null;
    var parts = durationStr.split(":").map(function(p) { return parseInt(p, 10); });
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }

  // Word-boundary keyword match (exact word, case-insensitive).
  // "car" matches "car crash" but NOT "cartoon".
  function matchesKeyword(text, keyword) {
    if (!text || !keyword) return false;
    var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return new RegExp("\\b" + escaped + "\\b", "i").test(text);
    } catch (e) {
      return text.toLowerCase().indexOf(keyword) !== -1;
    }
  }

  function isChannelWhitelisted(channelName) {
    if (!channelName || whitelistedChannels.length === 0) return false;
    var lower = channelName.toLowerCase();
    for (var i = 0; i < whitelistedChannels.length; i++) {
      if (lower.includes(whitelistedChannels[i])) return true;
    }
    return false;
  }

  // --- Channel signals (More/Less like this) ---
  function getChannelSignal(channelName) {
    if (!channelName) return 0;
    return channelSignals[channelName.trim()] || 0;
  }

  // direction: +1 (like) or -1 (dislike)
  // Same direction → increment further. Opposite direction → cancel to 0.
  function applyChannelSignal(channelName, direction) {
    if (!channelName) return;
    var name = channelName.trim();
    if (!name) return;
    var current = channelSignals[name] || 0;
    var next;
    if (current === 0) {
      next = direction;
    } else if ((current > 0 && direction > 0) || (current < 0 && direction < 0)) {
      next = current + direction;
    } else {
      next = 0;
    }
    if (next > 3) next = 3;
    if (next < -3) next = -3;
    if (next === 0) {
      delete channelSignals[name];
    } else {
      channelSignals[name] = next;
    }
    chrome.storage.local.set({ channelSignals: channelSignals });
    scheduleReprocess();
  }

  var _reprocessTimer = null;
  function scheduleReprocess() {
    if (_reprocessTimer) clearTimeout(_reprocessTimer);
    _reprocessTimer = setTimeout(function () {
      _reprocessTimer = null;
      reprocessAllCards();
    }, 200);
  }

  // --- Decide whether a video should be hidden ---
  function shouldHideVideo(video) {
    if (!enabled) return { hide: false, reason: "" };

    // Whitelist overrides everything
    if (isChannelWhitelisted(video.channel)) {
      return { hide: false, reason: "" };
    }

    // User dislike signal: hide channels marked down ≥ 2 times
    if (getChannelSignal(video.channel) <= -2) {
      return { hide: true, reason: "Disliked channel" };
    }

    if (hideShorts && video.isShort) {
      return { hide: true, reason: "Short video filtered" };
    }

    if (hideLiveStreams && video.isLive) {
      return { hide: true, reason: "Live stream filtered" };
    }

    if (hidePremieres && video.isPremiere) {
      return { hide: true, reason: "Premiere filtered" };
    }

    // Duration filter (skip if no duration info or video is live)
    if (!video.isLive && (minDurationSec > 0 || maxDurationSec > 0)) {
      var sec = parseDurationSec(video.duration);
      if (sec !== null) {
        if (minDurationSec > 0 && sec < minDurationSec) {
          return { hide: true, reason: "Too short (" + Math.floor(sec / 60) + "m)" };
        }
        if (maxDurationSec > 0 && sec > maxDurationSec) {
          return { hide: true, reason: "Too long (" + Math.floor(sec / 60) + "m)" };
        }
      }
    }

    // Keyword matching (word-boundary)
    var titleLower = video.title;
    for (var i = 0; i < blockedKeywords.length; i++) {
      if (blockedKeywords[i] && matchesKeyword(titleLower, blockedKeywords[i])) {
        return { hide: true, reason: 'Keyword: "' + blockedKeywords[i] + '"' };
      }
    }

    // Channel matching
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
    var contentDiv = card.querySelector("[class*='content-id-']") || card;
    var classList = contentDiv.className || "";
    var classMatch = classList.match(/content-id-([a-zA-Z0-9_-]+)/);
    if (classMatch) return classMatch[1];

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

    var titled = card.querySelector("a[title]");
    if (titled) {
      var t = (titled.getAttribute("title") || "").trim();
      if (t) return t;
    }

    var labeled = card.querySelector("a[aria-label]");
    if (labeled) {
      return (labeled.getAttribute("aria-label") || "").trim();
    }

    return "";
  }

  function extractChannelFromCard(card) {
    var channelLink = card.querySelector('a[href*="/@"]');
    if (channelLink) {
      var text = (channelLink.innerText || channelLink.textContent || "").trim();
      if (text) return text;
    }

    var el =
      card.querySelector("ytd-channel-name a") ||
      card.querySelector("ytd-channel-name yt-formatted-string") ||
      card.querySelector("#channel-name a") ||
      card.querySelector("#channel-name") ||
      card.querySelector("#byline a") ||
      card.querySelector("#byline");

    if (!el) return "";
    return (el.innerText || el.textContent || "").trim();
  }

  // --- Signal buttons (👍 / 👎) ---
  var SIGNAL_CSS =
    ".algocontrol-signals {" +
    "  position: absolute; top: 6px; left: 6px;" +
    "  display: flex; gap: 4px;" +
    "  opacity: 0; transition: opacity 0.15s;" +
    "  z-index: 100; pointer-events: none;" +
    "}" +
    "ytd-rich-item-renderer:hover .algocontrol-signals," +
    "yt-lockup-view-model:hover .algocontrol-signals," +
    "ytd-video-renderer:hover .algocontrol-signals," +
    "ytd-compact-video-renderer:hover .algocontrol-signals {" +
    "  opacity: 1; pointer-events: auto;" +
    "}" +
    ".algocontrol-signals.algocontrol-active { opacity: 1; pointer-events: auto; }" +
    ".algocontrol-sig {" +
    "  background: rgba(0,0,0,0.75);" +
    "  border: 1px solid rgba(255,255,255,0.25);" +
    "  border-radius: 4px;" +
    "  width: 28px; height: 28px;" +
    "  font-size: 14px; line-height: 1;" +
    "  cursor: pointer; padding: 0;" +
    "  display: flex; align-items: center; justify-content: center;" +
    "  color: #fff;" +
    "}" +
    ".algocontrol-sig:hover { background: rgba(0,0,0,0.9); transform: scale(1.08); }" +
    ".algocontrol-sig-up.active { background: rgba(45, 158, 95, 0.9); border-color: #2d9e5f; }" +
    ".algocontrol-sig-down.active { background: rgba(204, 51, 51, 0.9); border-color: #c33; }";

  function injectStaticCss() {
    if (document.getElementById("algocontrol-static-css")) return;
    var s = document.createElement("style");
    s.id = "algocontrol-static-css";
    s.textContent = SIGNAL_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function findThumbnailContainer(card) {
    // Prefer the thumbnail wrapper so positioning is relative to it
    return (
      card.querySelector("ytd-thumbnail") ||
      card.querySelector("yt-thumbnail-view-model") ||
      card.querySelector("yt-image") ||
      card.querySelector("#thumbnail") ||
      null
    );
  }

  function injectSignalButtons(card, channelName) {
    if (!channelName) return;
    var existing = card.querySelector(".algocontrol-signals");
    if (existing) {
      existing.dataset.channel = channelName;
      updateSignalButtonState(card, channelName);
      return;
    }
    var thumb = findThumbnailContainer(card);
    if (!thumb) return;

    // Ensure parent is positioned (most thumbnails already are, but be safe)
    var cs = window.getComputedStyle(thumb);
    if (cs.position === "static") thumb.style.position = "relative";

    var wrap = document.createElement("div");
    wrap.className = "algocontrol-signals";
    wrap.dataset.channel = channelName;

    var up = document.createElement("button");
    up.type = "button";
    up.className = "algocontrol-sig algocontrol-sig-up";
    up.title = "Show more from " + channelName;
    up.textContent = "👍"; // 👍
    up.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var ch = wrap.dataset.channel;
      applyChannelSignal(ch, +1);
      updateAllButtonsForChannel(ch);
    });

    var down = document.createElement("button");
    down.type = "button";
    down.className = "algocontrol-sig algocontrol-sig-down";
    down.title = "Show less from " + channelName;
    down.textContent = "👎"; // 👎
    down.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var ch = wrap.dataset.channel;
      applyChannelSignal(ch, -1);
      updateAllButtonsForChannel(ch);
    });

    wrap.appendChild(up);
    wrap.appendChild(down);
    thumb.appendChild(wrap);
    updateSignalButtonState(card, channelName);
  }

  function updateSignalButtonState(card, channelName) {
    var wrap = card.querySelector(".algocontrol-signals");
    if (!wrap) return;
    var sig = getChannelSignal(channelName);
    var up = wrap.querySelector(".algocontrol-sig-up");
    var down = wrap.querySelector(".algocontrol-sig-down");
    if (up) up.classList.toggle("active", sig > 0);
    if (down) down.classList.toggle("active", sig < 0);
    // Keep visible while a signal is set so the user can see/undo at a glance
    wrap.classList.toggle("algocontrol-active", sig !== 0);
  }

  function updateAllButtonsForChannel(channelName) {
    if (!channelName) return;
    var safe = (channelName + "").replace(/"/g, '\\"');
    var wraps = document.querySelectorAll('.algocontrol-signals[data-channel="' + safe + '"]');
    for (var i = 0; i < wraps.length; i++) {
      var card = wraps[i].closest("ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-compact-video-renderer") || wraps[i];
      updateSignalButtonState(card, channelName);
    }
  }

  function extractDurationFromCard(card) {
    // Duration text is in the time-status overlay on the thumbnail
    var el = card.querySelector(
      "ytd-thumbnail-overlay-time-status-renderer span.ytd-thumbnail-overlay-time-status-renderer, " +
      "ytd-thumbnail-overlay-time-status-renderer #text, " +
      "span.ytp-time-duration, " +
      "badge-shape[type='video-length'] span"
    );
    return el ? (el.innerText || el.textContent || "").trim() : "";
  }

  function isCardLiveOrPremiere(card) {
    var overlay = card.querySelector(
      "[overlay-style='LIVE'], [overlay-style='UPCOMING']"
    );
    return !!overlay;
  }

  // --- Dynamic CSS injection ---
  var _cssEl = null;

  function buildCss() {
    var rules = [];

    if (hideShorts) {
      rules.push(
        "ytd-reel-shelf-renderer { display: none !important; }",
        "ytd-reel-item-renderer { display: none !important; }",
        "ytd-rich-shelf-renderer:has(ytm-shorts-lockup-view-model) { display: none !important; }",
        "ytd-item-section-renderer:has(ytm-shorts-lockup-view-model):not(:has(yt-lockup-view-model, ytd-video-renderer, ytd-compact-video-renderer)) { display: none !important; }",
        "ytm-shorts-lockup-view-model { display: none !important; }",
        "ytm-shorts-lockup-view-model-v2 { display: none !important; }"
      );
    }

    if (hideLiveStreams) {
      var liveTargets = [
        "ytd-rich-item-renderer",
        "yt-lockup-view-model",
        "ytd-video-renderer",
        "ytd-compact-video-renderer",
      ];
      liveTargets.forEach(function(sel) {
        rules.push(sel + ":has([overlay-style='LIVE']) { display: none !important; }");
      });
    }

    if (hidePremieres) {
      var premiereTargets = [
        "ytd-rich-item-renderer",
        "yt-lockup-view-model",
        "ytd-video-renderer",
        "ytd-compact-video-renderer",
      ];
      premiereTargets.forEach(function(sel) {
        rules.push(sel + ":has([overlay-style='UPCOMING']) { display: none !important; }");
      });
    }

    return rules.join("\n");
  }

  function updateDynamicCss() {
    if (!enabled) {
      if (_cssEl) { _cssEl.remove(); _cssEl = null; }
      return;
    }
    var css = buildCss();
    if (!css) {
      if (_cssEl) { _cssEl.remove(); _cssEl = null; }
      return;
    }
    if (!_cssEl) {
      _cssEl = document.createElement("style");
      _cssEl.id = "algocontrol-css";
      (document.head || document.documentElement).appendChild(_cssEl);
    }
    _cssEl.textContent = css;
  }

  function applyFiltersToDOM() {
    updateDynamicCss();
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

    // Skip yt-lockup-view-model inside ytd-rich-item-renderer — parent handles it
    if (card.tagName === "YT-LOCKUP-VIEW-MODEL" &&
        card.closest("ytd-rich-item-renderer")) {
      return;
    }

    var videoId = getVideoIdFromCard(card);

    // API data path — evaluate with current preferences
    if (videoId && videoDataMap[videoId]) {
      var video = videoDataMap[videoId];
      injectSignalButtons(card, video.channel);
      var decision = shouldHideVideo(video);
      if (decision.hide) {
        hideCard(card, decision.reason);
        return;
      }
      showCard(card);
      updateSignalButtonState(card, video.channel);
      return;
    }

    // DOM fallback path
    var channel = extractChannelFromCard(card);
    injectSignalButtons(card, channel);

    // Whitelist check first
    if (isChannelWhitelisted(channel)) {
      showCard(card);
      updateSignalButtonState(card, channel);
      return;
    }

    // User dislike signal
    if (getChannelSignal(channel) <= -2) {
      hideCard(card, "Disliked channel");
      return;
    }

    // Shorts (CSS handles the shelf, this catches individual cards)
    if (hideShorts && isCardAShort(card)) {
      hideCard(card, "Short video filtered");
      return;
    }

    // Live / Premiere (CSS handles most cases, this is a backup)
    if ((hideLiveStreams || hidePremieres) && isCardLiveOrPremiere(card)) {
      var overlay = card.querySelector("[overlay-style='LIVE']");
      if (hideLiveStreams && overlay) {
        hideCard(card, "Live stream filtered");
        return;
      }
      var upcoming = card.querySelector("[overlay-style='UPCOMING']");
      if (hidePremieres && upcoming) {
        hideCard(card, "Premiere filtered");
        return;
      }
    }

    var title = extractTitleFromCard(card);

    // Duration check from DOM
    if (minDurationSec > 0 || maxDurationSec > 0) {
      var durStr = extractDurationFromCard(card);
      var sec = parseDurationSec(durStr);
      if (sec !== null) {
        if (minDurationSec > 0 && sec < minDurationSec) {
          hideCard(card, "Too short (" + Math.floor(sec / 60) + "m)");
          return;
        }
        if (maxDurationSec > 0 && sec > maxDurationSec) {
          hideCard(card, "Too long (" + Math.floor(sec / 60) + "m)");
          return;
        }
      }
    }

    // Keyword check (word-boundary)
    for (var i = 0; i < blockedKeywords.length; i++) {
      if (blockedKeywords[i] && matchesKeyword(title, blockedKeywords[i])) {
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

    // Playlist / mix check
    if (card.tagName === "YTD-RADIO-RENDERER" ||
        card.tagName === "YTD-PLAYLIST-RENDERER" ||
        card.tagName === "YTD-COMPACT-RADIO-RENDERER" ||
        card.tagName === "YTD-COMPACT-PLAYLIST-RENDERER") {
      var playlistTitle = extractPlaylistTitle(card);
      for (var p = 0; p < blockedKeywords.length; p++) {
        if (blockedKeywords[p] && matchesKeyword(playlistTitle, blockedKeywords[p])) {
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
    if (card.tagName === "YTD-REEL-SHELF-RENDERER" ||
        card.tagName === "YTD-REEL-ITEM-RENDERER") {
      return true;
    }
    if (card.querySelector("ytm-shorts-lockup-view-model") ||
        card.querySelector("ytm-shorts-lockup-view-model-v2")) {
      return true;
    }
    if (card.tagName === "YTD-RICH-SHELF-RENDERER" &&
        (card.querySelector("ytm-shorts-lockup-view-model") ||
         card.querySelector('a[href*="/shorts/"]'))) {
      return true;
    }
    if (card.querySelector('a[href*="/shorts/"]')) return true;
    if (card.querySelector("[overlay-style='SHORTS']")) return true;

    var badges = card.querySelectorAll(
      "ytd-thumbnail-overlay-time-status-renderer, badge-shape, yt-thumbnail-badge-view-model"
    );
    for (var b = 0; b < badges.length; b++) {
      var badgeText = (badges[b].innerText || badges[b].textContent || "").trim().toUpperCase();
      if (badgeText === "SHORTS" || badgeText === "SHORT") return true;
      if (badges[b].getAttribute("overlay-style") === "SHORTS") return true;
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

          var inner = node.querySelectorAll ? node.querySelectorAll(CARD_SELECTORS) : [];
          for (var k = 0; k < inner.length; k++) {
            processCard(inner[k]);
          }
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.log("[AlgoControl] DOM observer active — watching for new feed items");
  }

  // --- Badge counter ---
  function updateBadge() {
    chrome.runtime.sendMessage({
      type: "ALGOCONTROL_STATS",
      hidden: feedItemsHidden,
      total: feedItemsReceived,
    }).catch(function () {});
  }

  // --- Listen for intercepted data from MAIN world ---
  window.addEventListener("message", function (event) {
    if (
      event.source !== window ||
      !event.data ||
      event.data.type !== "ALGOCONTROL_FEED_DATA"
    ) return;

    console.log("[AlgoControl] Intercepted API response from:", event.data.endpoint);
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
  injectStaticCss();
  loadPreferences().then(function () {
    observeFeed();
    setTimeout(applyFiltersToDOM, 1500);
    setTimeout(applyFiltersToDOM, 4000);
  });

  // --- Diagnostic ---
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "ALGOCONTROL_DIAG") {
      runDiagnostic();
    }
  });

  function runDiagnostic() {
    var ytTags = {};
    var allEls = document.querySelectorAll("*");
    for (var i = 0; i < allEls.length; i++) {
      var tag = allEls[i].tagName.toLowerCase();
      if (tag.startsWith("ytd-") || tag.startsWith("yt-")) {
        ytTags[tag] = (ytTags[tag] || 0) + 1;
      }
    }
    console.log("%c[AlgoControl DIAGNOSTIC]", "color: #3ea6ff; font-size: 14px; font-weight: bold;");
    console.log("Page:", window.location.pathname);
    console.log("YT elements:", ytTags);
    console.log("Tracked videos:", Object.keys(videoDataMap).length);
    console.log("Cards matching selectors:", document.querySelectorAll(CARD_SELECTORS).length);
    console.log("State:", { enabled, hideShorts, hideLiveStreams, hidePremieres, minDurationSec, maxDurationSec });
  }

  console.log("[AlgoControl] Content script loaded");
})();
