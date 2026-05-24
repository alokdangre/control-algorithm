// popup.js — Settings UI for AlgoControl

(function () {
  "use strict";

  var enableToggle    = document.getElementById("enableToggle");
  var hideShorts      = document.getElementById("hideShorts");
  var hideLiveStreams = document.getElementById("hideLiveStreams");
  var hidePremieres   = document.getElementById("hidePremieres");
  var minDuration     = document.getElementById("minDuration");
  var maxDuration     = document.getElementById("maxDuration");
  var keywordInput    = document.getElementById("keywordInput");
  var addKeywordBtn   = document.getElementById("addKeyword");
  var keywordTags     = document.getElementById("keywordTags");
  var channelInput    = document.getElementById("channelInput");
  var addChannelBtn   = document.getElementById("addChannel");
  var channelTags     = document.getElementById("channelTags");
  var whitelistInput  = document.getElementById("whitelistInput");
  var addWhitelistBtn = document.getElementById("addWhitelist");
  var whitelistTags   = document.getElementById("whitelistTags");
  var hiddenCount     = document.getElementById("hiddenCount");
  var totalCount      = document.getElementById("totalCount");
  var trackedCount    = document.getElementById("trackedCount");
  var statusText      = document.getElementById("statusText");

  var DEFAULTS = {
    enabled: true,
    blockedKeywords: [],
    blockedChannels: [],
    whitelistedChannels: [],
    hideShorts: false,
    hideLiveStreams: false,
    hidePremieres: false,
    minDurationSec: 0,
    maxDurationSec: 0,
  };

  var prefs = Object.assign({}, DEFAULTS);

  // --- Load ---
  function loadPrefs() {
    chrome.storage.local.get(DEFAULTS, function (result) {
      prefs = result;
      enableToggle.checked    = prefs.enabled;
      hideShorts.checked      = prefs.hideShorts;
      hideLiveStreams.checked  = prefs.hideLiveStreams;
      hidePremieres.checked   = prefs.hidePremieres;
      minDuration.value = prefs.minDurationSec > 0 ? Math.floor(prefs.minDurationSec / 60) : "";
      maxDuration.value = prefs.maxDurationSec > 0 ? Math.floor(prefs.maxDurationSec / 60) : "";
      renderTags(keywordTags,   prefs.blockedKeywords,    "keyword");
      renderTags(channelTags,   prefs.blockedChannels,    "channel");
      renderTags(whitelistTags, prefs.whitelistedChannels, "whitelist");
      updateStatus();
    });
  }

  function savePrefs() {
    chrome.storage.local.set(prefs);
  }

  // --- Tags ---
  function renderTags(container, items, type) {
    if (!items || items.length === 0) {
      container.innerHTML = '<span class="empty-msg">None added</span>';
      return;
    }
    container.innerHTML = "";
    items.forEach(function (item, index) {
      var tag = document.createElement("span");
      tag.className = "tag" + (type === "whitelist" ? " tag-whitelist" : "");
      tag.innerHTML =
        item +
        ' <span class="tag-remove" data-type="' + type + '" data-index="' + index + '">&times;</span>';
      container.appendChild(tag);
    });
  }

  // --- Add helpers ---
  function addItems(input, listKey, tagsEl, type) {
    var val = input.value.trim();
    if (!val) return;
    val.split(",").map(function (v) { return v.trim(); }).filter(Boolean).forEach(function (item) {
      if (prefs[listKey].indexOf(item) === -1) prefs[listKey].push(item);
    });
    input.value = "";
    renderTags(tagsEl, prefs[listKey], type);
    savePrefs();
  }

  // --- Remove tag ---
  document.addEventListener("click", function (e) {
    if (!e.target.classList.contains("tag-remove")) return;
    var type  = e.target.dataset.type;
    var index = parseInt(e.target.dataset.index, 10);
    var map   = { keyword: "blockedKeywords", channel: "blockedChannels", whitelist: "whitelistedChannels" };
    var tagsMap = { keyword: keywordTags, channel: channelTags, whitelist: whitelistTags };
    if (!map[type]) return;
    prefs[map[type]].splice(index, 1);
    renderTags(tagsMap[type], prefs[map[type]], type);
    savePrefs();
  });

  // --- Duration change ---
  function saveDuration() {
    var minVal = parseInt(minDuration.value, 10);
    var maxVal = parseInt(maxDuration.value, 10);
    prefs.minDurationSec = (!isNaN(minVal) && minVal > 0) ? minVal * 60 : 0;
    prefs.maxDurationSec = (!isNaN(maxVal) && maxVal > 0) ? maxVal * 60 : 0;
    savePrefs();
  }

  minDuration.addEventListener("change", saveDuration);
  maxDuration.addEventListener("change", saveDuration);

  // --- Checkbox handlers ---
  enableToggle.addEventListener("change", function () {
    prefs.enabled = enableToggle.checked;
    savePrefs();
    updateStatus();
  });

  hideShorts.addEventListener("change", function () {
    prefs.hideShorts = hideShorts.checked;
    savePrefs();
  });

  hideLiveStreams.addEventListener("change", function () {
    prefs.hideLiveStreams = hideLiveStreams.checked;
    savePrefs();
  });

  hidePremieres.addEventListener("change", function () {
    prefs.hidePremieres = hidePremieres.checked;
    savePrefs();
  });

  // --- Button + Enter key ---
  addKeywordBtn.addEventListener("click", function () {
    addItems(keywordInput, "blockedKeywords", keywordTags, "keyword");
  });
  addChannelBtn.addEventListener("click", function () {
    addItems(channelInput, "blockedChannels", channelTags, "channel");
  });
  addWhitelistBtn.addEventListener("click", function () {
    addItems(whitelistInput, "whitelistedChannels", whitelistTags, "whitelist");
  });

  keywordInput.addEventListener("keydown",   function (e) { if (e.key === "Enter") addItems(keywordInput, "blockedKeywords", keywordTags, "keyword"); });
  channelInput.addEventListener("keydown",   function (e) { if (e.key === "Enter") addItems(channelInput, "blockedChannels", channelTags, "channel"); });
  whitelistInput.addEventListener("keydown", function (e) { if (e.key === "Enter") addItems(whitelistInput, "whitelistedChannels", whitelistTags, "whitelist"); });

  // --- Status ---
  function updateStatus() {
    if (prefs.enabled) {
      statusText.textContent = "Active on YouTube";
      statusText.className = "status-active";
    } else {
      statusText.textContent = "Filtering disabled";
      statusText.className = "status-inactive";
    }
  }

  // --- Stats ---
  function fetchStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || !tabs[0].url || !tabs[0].url.includes("youtube.com")) {
        statusText.textContent = "Open YouTube to start filtering";
        statusText.className = "status-inactive";
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATS" }, function (response) {
        if (chrome.runtime.lastError || !response) return;
        hiddenCount.textContent  = response.hidden || 0;
        totalCount.textContent   = response.total || 0;
        trackedCount.textContent = response.trackedVideos || 0;
      });
    });
  }

  // --- Init ---
  loadPrefs();
  fetchStats();
  setInterval(fetchStats, 2000);
})();
