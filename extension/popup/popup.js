// popup.js — Settings UI for AlgoControl

(function () {
  "use strict";

  var enableToggle = document.getElementById("enableToggle");
  var hideShorts = document.getElementById("hideShorts");
  var keywordInput = document.getElementById("keywordInput");
  var addKeywordBtn = document.getElementById("addKeyword");
  var keywordTags = document.getElementById("keywordTags");
  var channelInput = document.getElementById("channelInput");
  var addChannelBtn = document.getElementById("addChannel");
  var channelTags = document.getElementById("channelTags");
  var hiddenCount = document.getElementById("hiddenCount");
  var totalCount = document.getElementById("totalCount");
  var trackedCount = document.getElementById("trackedCount");
  var statusText = document.getElementById("statusText");

  var prefs = {
    enabled: true,
    blockedKeywords: [],
    blockedChannels: [],
    hideShorts: false,
  };

  // --- Load preferences ---
  function loadPrefs() {
    chrome.storage.local.get(
      {
        enabled: true,
        blockedKeywords: [],
        blockedChannels: [],
        hideShorts: false,
      },
      function (result) {
        prefs = result;
        enableToggle.checked = prefs.enabled;
        hideShorts.checked = prefs.hideShorts;
        renderTags(keywordTags, prefs.blockedKeywords, "keyword");
        renderTags(channelTags, prefs.blockedChannels, "channel");
        updateStatus();
      }
    );
  }

  // --- Save preferences ---
  function savePrefs() {
    chrome.storage.local.set(prefs);
  }

  // --- Render tags ---
  function renderTags(container, items, type) {
    if (items.length === 0) {
      container.innerHTML = '<span class="empty-msg">None added yet</span>';
      return;
    }

    container.innerHTML = "";
    items.forEach(function (item, index) {
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.innerHTML =
        item +
        ' <span class="tag-remove" data-type="' +
        type +
        '" data-index="' +
        index +
        '">&times;</span>';
      container.appendChild(tag);
    });
  }

  // --- Add keyword ---
  function addKeyword() {
    var val = keywordInput.value.trim();
    if (!val) return;

    var keywords = val.split(",").map(function (k) {
      return k.trim();
    }).filter(function (k) {
      return k.length > 0;
    });

    keywords.forEach(function (kw) {
      if (prefs.blockedKeywords.indexOf(kw) === -1) {
        prefs.blockedKeywords.push(kw);
      }
    });

    keywordInput.value = "";
    renderTags(keywordTags, prefs.blockedKeywords, "keyword");
    savePrefs();
  }

  // --- Add channel ---
  function addChannel() {
    var val = channelInput.value.trim();
    if (!val) return;

    var channels = val.split(",").map(function (c) {
      return c.trim();
    }).filter(function (c) {
      return c.length > 0;
    });

    channels.forEach(function (ch) {
      if (prefs.blockedChannels.indexOf(ch) === -1) {
        prefs.blockedChannels.push(ch);
      }
    });

    channelInput.value = "";
    renderTags(channelTags, prefs.blockedChannels, "channel");
    savePrefs();
  }

  // --- Remove tag ---
  document.addEventListener("click", function (e) {
    if (!e.target.classList.contains("tag-remove")) return;

    var type = e.target.dataset.type;
    var index = parseInt(e.target.dataset.index, 10);

    if (type === "keyword") {
      prefs.blockedKeywords.splice(index, 1);
      renderTags(keywordTags, prefs.blockedKeywords, "keyword");
    } else if (type === "channel") {
      prefs.blockedChannels.splice(index, 1);
      renderTags(channelTags, prefs.blockedChannels, "channel");
    }
    savePrefs();
  });

  // --- Toggle handlers ---
  enableToggle.addEventListener("change", function () {
    prefs.enabled = enableToggle.checked;
    savePrefs();
    updateStatus();
  });

  hideShorts.addEventListener("change", function () {
    prefs.hideShorts = hideShorts.checked;
    savePrefs();
  });

  // --- Enter key support ---
  keywordInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") addKeyword();
  });

  channelInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") addChannel();
  });

  // --- Button handlers ---
  addKeywordBtn.addEventListener("click", addKeyword);
  addChannelBtn.addEventListener("click", addChannel);

  // --- Update status ---
  function updateStatus() {
    if (prefs.enabled) {
      statusText.textContent = "Active on YouTube";
      statusText.className = "status-active";
    } else {
      statusText.textContent = "Filtering disabled";
      statusText.className = "status-inactive";
    }
  }

  // --- Get stats from content script ---
  function fetchStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || !tabs[0].url || !tabs[0].url.includes("youtube.com")) {
        statusText.textContent = "Open YouTube to start filtering";
        statusText.className = "status-inactive";
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "GET_STATS" },
        function (response) {
          if (chrome.runtime.lastError || !response) return;
          hiddenCount.textContent = response.hidden || 0;
          totalCount.textContent = response.total || 0;
          trackedCount.textContent = response.trackedVideos || 0;
        }
      );
    });
  }

  // --- Init ---
  loadPrefs();
  fetchStats();
  setInterval(fetchStats, 2000);
})();
