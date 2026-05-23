# AlgoControl — Technical Architecture (Detailed)

## What We're Actually Building

A **passive feed filter** Chrome extension. It sits between what platforms send to your browser and what gets rendered on screen. The user sets preferences once (or updates them over time), and the extension silently intercepts, classifies, filters, and re-ranks feed content in real time.

We are NOT modifying any platform's server-side algorithm. We are building a **client-side post-processing layer**.

```
YouTube Server ──sends feed data──> [OUR EXTENSION INTERCEPTS HERE] ──filtered data──> Browser renders
```

---

## Part 1: How YouTube Interception Actually Works

### 1.1 YouTube's Internal Architecture

YouTube is a Single Page Application (SPA) built with Polymer/Web Components. It does NOT reload the page when you navigate — it fetches data via internal API calls and renders it dynamically.

**Key YouTube API endpoints (all POST to `/youtubei/v1/`):**

| Endpoint | What it fetches |
|----------|----------------|
| `/youtubei/v1/browse` | Homepage feed, channel pages, subscription feed, trending |
| `/youtubei/v1/next` | Watch page sidebar (recommended videos), comments, live chat |
| `/youtubei/v1/search` | Search results |
| `/youtubei/v1/player` | Video player data (stream URLs, captions, metadata) |
| `/youtubei/v1/guide` | Left sidebar navigation |

**Every request includes a `context` object:**
```json
{
  "context": {
    "client": {
      "hl": "en",
      "gl": "US",
      "clientName": "WEB",
      "clientVersion": "2.20250425.01.00"
    },
    "user": {},
    "request": {}
  }
}
```

**Every response is JSON containing "renderer" objects:**

```
Response
└── contents
    └── twoColumnBrowseResultsRenderer (homepage)
        └── tabs
            └── tabRenderer
                └── content
                    └── richGridRenderer
                        └── contents[]
                            ├── richItemRenderer        ← THIS IS A VIDEO CARD
                            │   └── content
                            │       └── videoRenderer
                            │           ├── videoId
                            │           ├── title.runs[].text
                            │           ├── ownerText (channel name)
                            │           ├── viewCountText
                            │           ├── publishedTimeText
                            │           ├── descriptionSnippet
                            │           ├── thumbnail
                            │           └── lengthText
                            ├── richItemRenderer (next video)
                            └── continuationItemRenderer ← PAGINATION TOKEN
                                └── continuationEndpoint
                                    └── continuationCommand
                                        └── token: "Eg0SC..."
```

**Pagination works via continuation tokens:** When you scroll down, YouTube sends the continuation token back to `/browse`, and it returns the next batch. The token is a cursor — it ensures the server sends the correct next page.

### 1.2 The Two-Layer Interception Strategy

We use two layers because neither alone is sufficient:

```
Layer 1: NETWORK INTERCEPTION (catches data before rendering)
    ↓ fails silently for edge cases
Layer 2: DOM CLEANUP (catches anything Layer 1 missed)
```

This is exactly what FilterTube does — "a two-layer system: intercepts YouTube's data first, then monitors the page as backup."

---

### 1.3 Layer 1: Network Interception (XHR/Fetch Monkey-Patching)

**The problem:** YouTube fetches feed data via `fetch()` or `XMLHttpRequest`. Chrome's `webRequest` API does NOT expose response bodies. So we can't read the feed data using the standard extension API.

**The solution:** Inject a script into YouTube's **main execution world** that monkey-patches `fetch()` and `XMLHttpRequest.prototype.open` — intercepting the response before YouTube's own code processes it.

#### Step 1: Register a main-world content script (Manifest V3)

In `manifest.json`:
```json
{
  "manifest_version": 3,
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["interceptor.js"],
      "world": "MAIN",
      "run_at": "document_start"
    },
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["content.js"],
      "world": "ISOLATED",
      "run_at": "document_start"
    }
  ]
}
```

**Two scripts, two worlds:**
- `interceptor.js` runs in `MAIN` world → same JavaScript context as YouTube's own code → can monkey-patch `fetch` and `XMLHttpRequest`
- `content.js` runs in `ISOLATED` world → has access to Chrome extension APIs (`chrome.runtime`, `chrome.storage`) → receives data from interceptor

#### Step 2: Monkey-patch `fetch()` in the main world

```javascript
// interceptor.js (runs in MAIN world — same context as YouTube)

const originalFetch = window.fetch;

window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  const url = (args[0] instanceof Request) ? args[0].url : args[0];

  // Only intercept YouTube API calls
  if (url.includes('/youtubei/v1/browse') ||
      url.includes('/youtubei/v1/next') ||
      url.includes('/youtubei/v1/search')) {

    // Clone the response so YouTube's code still works
    const clone = response.clone();
    const json = await clone.json();

    // Send the data to our isolated content script for processing
    window.postMessage({
      type: 'ALGOCONTROL_FEED_DATA',
      endpoint: url,
      data: json
    }, '*');
  }

  return response;
};
```

**Why `response.clone()`?** A Response body can only be read once. If we read it, YouTube's own code gets nothing. Cloning lets both us and YouTube read the data.

#### Step 3: Also patch XMLHttpRequest (some YouTube paths still use XHR)

```javascript
// interceptor.js (continued)

const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this._algocontrol_url = url;
  return originalXHROpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (...args) {
  this.addEventListener('load', function () {
    if (this._algocontrol_url &&
        (this._algocontrol_url.includes('/youtubei/v1/browse') ||
         this._algocontrol_url.includes('/youtubei/v1/next') ||
         this._algocontrol_url.includes('/youtubei/v1/search'))) {
      try {
        const json = JSON.parse(this.responseText);
        window.postMessage({
          type: 'ALGOCONTROL_FEED_DATA',
          endpoint: this._algocontrol_url,
          data: json
        }, '*');
      } catch (e) {
        // Not JSON, ignore
      }
    }
  });
  return originalXHRSend.apply(this, args);
};
```

#### Step 4: Content script receives and processes the data

```javascript
// content.js (runs in ISOLATED world — has chrome.* APIs)

window.addEventListener('message', async (event) => {
  if (event.data?.type !== 'ALGOCONTROL_FEED_DATA') return;

  const { endpoint, data } = event.data;

  // Load user preferences from storage
  const prefs = await chrome.storage.local.get('preferences');

  // Extract video items from the response
  const videos = extractVideoRenderers(data);

  // Classify and score each video
  const scored = await classifyAndScore(videos, prefs.preferences);

  // Tell the DOM manipulator which videos to hide/reorder
  applyFilterDecisions(scored);
});
```

#### The full data flow:

```
YouTube Server
    │
    ▼
fetch('/youtubei/v1/browse')
    │
    ▼
interceptor.js (MAIN world) ─── monkey-patched fetch() catches response
    │                          │
    │ response.clone()         │ window.postMessage()
    │                          ▼
    │                    content.js (ISOLATED world)
    │                          │
    │                          ▼
    │                    Load user preferences (chrome.storage)
    │                          │
    │                          ▼
    │                    AI classifier scores each video
    │                          │
    │                          ▼
    │                    DOM Manipulator hides/reorders elements
    │
    ▼
YouTube's own code renders the page (unaware of us)
    │
    ▼
DOM Manipulator modifies the rendered output
```

**Important nuance:** We are NOT modifying the `fetch` response that YouTube receives. YouTube renders everything normally. We then manipulate the DOM *after* rendering. The network interception gives us the *data* to make smart decisions — the DOM manipulation does the *actual filtering*.

Could we modify the response before YouTube gets it? Technically yes (return a modified Response from the patched fetch), but it's fragile — YouTube's code expects specific structures, and any mismatch causes errors or blank feeds. The safer approach: let YouTube render, then manipulate the DOM.

---

### 1.4 Layer 2: DOM Manipulation (The Actual Filtering)

Once our content script knows which videos to hide/boost/demote, it modifies the rendered page.

#### How YouTube's DOM is structured

```html
<!-- YouTube homepage -->
<ytd-rich-grid-renderer>                    <!-- The feed grid -->
  <div id="contents">
    <ytd-rich-item-renderer>                <!-- One video card -->
      <ytd-rich-grid-media>
        <ytd-thumbnail>...</ytd-thumbnail>
        <div id="details">
          <a id="video-title-link">
            <yt-formatted-string id="video-title">Video Title Here</yt-formatted-string>
          </a>
          <ytd-video-meta-block>
            <a class="yt-simple-endpoint">Channel Name</a>
            <span>1.2M views</span>
            <span>2 days ago</span>
          </ytd-video-meta-block>
        </div>
      </ytd-rich-grid-media>
    </ytd-rich-item-renderer>

    <ytd-rich-item-renderer>...</ytd-rich-item-renderer>  <!-- next card -->
    <ytd-rich-item-renderer>...</ytd-rich-item-renderer>
  </div>
</ytd-rich-grid-renderer>
```

#### Hiding a video

```javascript
function hideVideo(videoId) {
  const cards = document.querySelectorAll('ytd-rich-item-renderer');
  for (const card of cards) {
    const link = card.querySelector('a#video-title-link');
    if (link && link.href.includes(videoId)) {
      card.style.display = 'none';
      card.dataset.algocontrolHidden = 'true';
      break;
    }
  }
}
```

#### Re-ordering videos (boosting preferred content)

```javascript
function reorderFeed(scoredVideos) {
  const container = document.querySelector('ytd-rich-grid-renderer #contents');
  if (!container) return;

  // Sort by our score (highest first)
  const sorted = scoredVideos.sort((a, b) => b.score - a.score);

  // Reorder DOM elements to match our ranking
  for (const { videoId } of sorted) {
    const card = findCardByVideoId(videoId);
    if (card) {
      container.appendChild(card); // moves element to end in sorted order
    }
  }
}
```

#### Adding explainability badges

```javascript
function addFilterBadge(videoId, reason) {
  const card = findCardByVideoId(videoId);
  if (!card || card.querySelector('.algocontrol-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'algocontrol-badge';
  badge.textContent = reason; // e.g. "Boosted: matches 'science' preference"
  badge.style.cssText = 'font-size:11px; color:#1a73e8; padding:2px 6px; ...';

  const details = card.querySelector('#details');
  if (details) details.prepend(badge);
}
```

#### Handling infinite scroll (continuation)

YouTube loads more videos when you scroll down. We need to watch for new DOM elements:

```javascript
const feedObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeName === 'YTD-RICH-ITEM-RENDERER') {
        // New video card appeared — run our filter on it
        processNewCard(node);
      }
    }
  }
});

const feedContainer = document.querySelector('ytd-rich-grid-renderer #contents');
if (feedContainer) {
  feedObserver.observe(feedContainer, { childList: true });
}
```

---

### 1.5 YouTube Watch Page (Sidebar Recommendations)

Different DOM structure, same principle:

```html
<!-- Watch page sidebar -->
<ytd-watch-next-secondary-results-renderer>
  <div id="items">
    <ytd-compact-video-renderer>         <!-- Sidebar recommendation -->
      <ytd-thumbnail>...</ytd-thumbnail>
      <div class="metadata">
        <span id="video-title">Recommended Video</span>
        <ytd-channel-name>Channel</ytd-channel-name>
      </div>
    </ytd-compact-video-renderer>
  </div>
</ytd-watch-next-secondary-results-renderer>
```

The data comes from `/youtubei/v1/next` instead of `/browse`. Same interception pattern, different selectors for DOM manipulation.

### 1.6 YouTube Shorts

Shorts appear in the feed as `ytd-rich-item-renderer` with a `ytd-reel-item-renderer` inside, and as a full-screen experience at `/shorts/`. For the feed: same DOM manipulation — detect reel renderers and hide them if the user doesn't want Shorts. For the `/shorts/` page: more complex (it's a different UI), but we can redirect to the homepage or show a "blocked by AlgoControl" overlay.

### 1.7 YouTube Search Results

Data from `/youtubei/v1/search`. DOM elements are `ytd-video-renderer` inside `ytd-search`. Same interception + DOM manipulation pattern.

---

## Part 2: How AI Classification Works

The intercepted data gives us raw video metadata. The AI turns that into actionable signals.

### 2.1 What data we get per video (from network interception)

```
├── videoId: "dQw4w9WgXcQ"
├── title: "Never Gonna Give You Up"
├── channelName: "Rick Astley"
├── channelId: "UCuAXFkgsw1L7xaCfnd5JJOw"
├── viewCount: "1,500,000,000"
├── publishedTime: "17 years ago"
├── duration: "3:33"
├── description: "The official video for..."
├── thumbnail: { url, width, height }
├── badges: ["4K", "CC"]
└── (no tags or full description — those are only in /player responses)
```

### 2.2 Classification pipeline

```
Raw Video Metadata
    │
    ▼
┌─────────────────────────────────┐
│  STAGE 1: Rule-Based Filters    │  ← Instant, no AI needed
│  - Keyword blacklist/whitelist  │
│  - Channel blacklist/whitelist  │
│  - Duration range filter        │
│  - "Is this a Short?" check     │
│  - Language detection            │
└─────────────────────────────────┘
    │ (passes filter)
    ▼
┌─────────────────────────────────┐
│  STAGE 2: AI Topic Classifier   │  ← Lightweight ML
│  Input: title + channel + desc  │
│  Output: topic tags with scores │
│  e.g. {science: 0.8, tech: 0.6}│
│                                 │
│  Uses: TF-IDF or small          │
│  transformer (Gemini Nano /     │
│  ONNX model in browser)         │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  STAGE 3: Engagement-Bait       │  ← Learned patterns
│  Detector                       │
│  - ALL CAPS title?              │
│  - Excessive punctuation?!?!    │
│  - Clickbait phrases            │
│    ("you won't believe", "gone  │
│     wrong", "shocking")         │
│  - Thumbnail face analysis      │
│    (surprised face = bait)      │
│  Output: bait_score 0.0 - 1.0  │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  STAGE 4: Sentiment Analyzer    │  ← Optional, heavier
│  - Positive / negative / neutral│
│  - Outrage detection            │
│  - Toxicity score               │
│  Output: sentiment label + score│
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  STAGE 5: Final Scoring         │
│                                 │
│  score = (topic_match × 0.4)    │
│        + (1 - bait_score) × 0.2 │
│        + sentiment_match × 0.2  │
│        + freshness × 0.1        │
│        + source_trust × 0.1     │
│                                 │
│  Weights come from user prefs   │
└─────────────────────────────────┘
    │
    ▼
  DECISION: show / hide / demote / boost / badge
```

### 2.3 Where does the AI run?

**Option A: On-device (preferred for privacy)**
- Chrome's built-in Gemini Nano API (available since Chrome 127)
- TensorFlow.js with a small quantized model bundled in the extension
- ONNX Runtime Web for pre-trained classifiers
- Performance: ~5-20ms per video title classification

**Option B: User-provided API key (for heavy classification)**
- User enters their own OpenAI/Claude/Gemini API key
- Extension sends batch of titles for classification
- More accurate, but costs money and has latency
- Good for initial "learn my preferences" phase

**Option C: Our backend (for premium tier)**
- We run the classifier
- User data is encrypted in transit
- Only sends titles + channel names, never browsing history

**Recommended approach:** Start with Stage 1 (rule-based, zero AI) + Stage 2 with a small TF-IDF model (runs in milliseconds, bundled in extension). Add Stages 3-4 with on-device Gemini Nano for users who opt in.

---

## Part 3: User Preference System

### 3.1 How users set preferences

The extension popup / side panel provides a preferences UI:

```
┌──────────────────────────────────────────────┐
│  AlgoControl Preferences                     │
│──────────────────────────────────────────────│
│                                              │
│  TOPICS                                      │
│  ┌──────────────────┬─────────────────────┐  │
│  │ Science          │ ████████████░░ More  │  │
│  │ Technology       │ ██████████░░░░ More  │  │
│  │ Music            │ ████████░░░░░░ OK    │  │
│  │ Politics         │ ██░░░░░░░░░░░░ Less  │  │
│  │ Celebrity Gossip │ ░░░░░░░░░░░░░░ None  │  │
│  └──────────────────┴─────────────────────┘  │
│                                              │
│  FILTERS                                     │
│  [x] Hide Shorts                             │
│  [x] Demote clickbait (AI-detected)          │
│  [ ] Hide videos under 1 min                 │
│  [x] Hide videos over 2 hours                │
│                                              │
│  CHANNELS                                    │
│  Blocked: @DramaAlert, @TMZ                  │
│  Boosted: @3Blue1Brown, @Veritasium          │
│                                              │
│  MODE: [ Balanced ] [ Focus ] [ Discovery ]  │
│                                              │
│  ⚡ Filter stats: 12 hidden, 5 boosted today │
└──────────────────────────────────────────────┘
```

### 3.2 Preference schema (stored in chrome.storage.local)

```json
{
  "version": 2,
  "topics": {
    "science": { "weight": 0.9, "action": "boost" },
    "politics": { "weight": 0.2, "action": "demote" },
    "celebrity": { "weight": 0.0, "action": "hide" }
  },
  "channels": {
    "blocked": ["UCxxxxxx", "UCyyyyyy"],
    "boosted": ["UCzzzzzz"]
  },
  "filters": {
    "hideShorts": true,
    "hideClickbait": true,
    "clickbaitThreshold": 0.7,
    "minDuration": 60,
    "maxDuration": 7200,
    "hideSentiment": ["outrage"]
  },
  "mode": "balanced",
  "platforms": {
    "youtube": { "enabled": true },
    "x": { "enabled": true },
    "instagram": { "enabled": false }
  }
}
```

---

## Part 4: Hybrid Data Storage Architecture

### 4.1 What lives where

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│     LOCAL (Browser)          │     │     CLOUD (Our Backend)     │
│─────────────────────────────│     │─────────────────────────────│
│                             │     │                             │
│  chrome.storage.local:      │     │  PostgreSQL / Supabase:     │
│  ├── User preferences       │     │  ├── User account           │
│  ├── Active filter rules    │     │  ├── Preference snapshots   │
│  ├── Current session state   │     │    (for cross-device sync)  │
│  └── Extension config       │     │  ├── Aggregated filter      │
│                             │     │  │   effectiveness stats     │
│  IndexedDB:                 │     │  ├── Long-term interaction   │
│  ├── Classification cache   │     │  │   history (anonymized)    │
│  │   (videoId → topic tags) │     │  ├── AI model personalization│
│  ├── Filter decision log    │     │  │   weights                 │
│  │   (last 30 days)         │     │  ├── Community filter packs  │
│  ├── Channel metadata cache │     │  └── Subscription/billing    │
│  └── Offline preference     │     │                             │
│      queue                  │     │  Redis:                     │
│                             │     │  ├── Session tokens          │
│  NEVER leaves the browser:  │     │  └── Rate limiting           │
│  ├── Browsing history       │     │                             │
│  ├── Watch history          │     │  NEVER stored:               │
│  ├── Raw feed data          │     │  ├── Browsing history        │
│  └── Video content          │     │  ├── Watch history           │
│                             │     │  ├── Raw feed content        │
└─────────────────────────────┘     └─────────────────────────────┘
            │                                    │
            └──────── Encrypted Sync ────────────┘
              (only preferences & anonymized stats)
```

### 4.2 Sync protocol

```
Extension                           Backend
   │                                    │
   ├── User changes preference ──────>  │
   │   POST /api/sync/preferences       │
   │   Body: { encrypted preferences }  │
   │                                    │
   │  <── 200 OK + merged preferences ──┤
   │      (if conflict, latest wins     │
   │       or user resolves)            │
   │                                    │
   │── Every 24h: send stats ────────>  │
   │   POST /api/sync/stats             │
   │   Body: {                          │
   │     videos_filtered: 142,          │
   │     top_topics: ["science"],       │
   │     avg_bait_score_hidden: 0.82    │
   │   }                               │
   │   (NO video IDs, NO titles,        │
   │    NO watch history)               │
   │                                    │
   │── On new device login: ─────────>  │
   │   GET /api/sync/preferences        │
   │  <── encrypted preferences ────────┤
   │   Extension decrypts locally       │
   │                                    │
```

### 4.3 Why hybrid?

| Concern | Local-only problem | Cloud-only problem | Hybrid solution |
|---------|-------------------|-------------------|-----------------|
| Cross-device | No sync at all | Full sync | Preferences sync, browsing data stays local |
| Privacy | Maximum privacy | We see everything | We see only anonymized stats + encrypted prefs |
| Personalization | Limited to one device's history | Can build rich models | Enough data to improve, not enough to surveil |
| Offline | Works always | Broken offline | Core filtering works offline, sync when connected |
| Data loss | Browser wipe = gone | Safe | Preferences recoverable from cloud |

### 4.4 Backend tech stack

```
┌──────────────────────────────────────────┐
│            Backend Architecture           │
│──────────────────────────────────────────│
│                                          │
│  API Layer:     Node.js + Express / Hono │
│  Database:      PostgreSQL (Supabase)    │
│  Cache:         Redis                    │
│  Auth:          Supabase Auth (OAuth)    │
│  File Storage:  Supabase Storage         │
│  Hosting:       Vercel / Railway         │
│  Encryption:    AES-256-GCM (client-side │
│                 encryption before send)  │
│                                          │
│  API Endpoints:                          │
│  POST /api/auth/login                    │
│  POST /api/auth/register                 │
│  GET  /api/sync/preferences              │
│  POST /api/sync/preferences              │
│  POST /api/sync/stats                    │
│  GET  /api/community/filter-packs        │
│  POST /api/feedback/classification       │
│                                          │
└──────────────────────────────────────────┘
```

---

## Part 5: How Other Platforms Work

### 5.1 X (Twitter)

**Feed data source:** X uses GraphQL endpoints. Feed data comes from requests to `https://x.com/i/api/graphql/{hash}/HomeTimeline`

**DOM structure:** React-based. Feed items are `<article>` elements inside `[data-testid="primaryColumn"]`.

**Interception approach:** Same two-layer strategy — intercept GraphQL responses via fetch monkey-patching, then manipulate the DOM. The GraphQL response contains `tweet_results` → `result` → `legacy` objects with full tweet metadata.

**Advantage:** X's recommendation algorithm is [open-source on GitHub](https://github.com/twitter/the-algorithm), so we know exactly what signals it uses and can build counter-signals.

**Challenge:** X changes its GraphQL schema and DOM structure frequently. Need a robust selector abstraction layer.

### 5.2 Instagram

**Feed data source:** GraphQL endpoints similar to X. Feed data via `https://www.instagram.com/graphql/query/`

**DOM structure:** React-based. Posts are in `<article>` elements.

**Challenge:** Instagram is significantly harder than YouTube:
- More aggressive code obfuscation (class names are randomized hashes)
- Response data may be signed or validated
- More frequent DOM structure changes
- Reels have a completely different rendering pipeline

**Approach:** Start with DOM-level filtering (less fragile than network interception for Instagram). Use `aria-label` attributes and semantic structure as selector anchors since they change less frequently than class names.

**Honest assessment:** Instagram support needs dedicated Phase 3 research. Don't promise feature parity with YouTube.

### 5.3 Platform adapter pattern

Each platform gets its own adapter module:

```
src/
├── adapters/
│   ├── base-adapter.ts        ← Abstract interface
│   ├── youtube-adapter.ts     ← YouTube-specific interception + DOM
│   ├── x-adapter.ts           ← X/Twitter-specific
│   └── instagram-adapter.ts   ← Instagram-specific
├── core/
│   ├── classifier.ts          ← AI classification pipeline
│   ├── preference-engine.ts   ← User rules → filter decisions
│   ├── scorer.ts              ← Final score computation
│   └── sync.ts                ← Cloud sync logic
├── interceptor.js             ← Main-world fetch/XHR patches
├── content.js                 ← Isolated-world orchestrator
├── service-worker.js          ← Background tasks, alarms, sync
└── popup/                     ← Settings UI
```

Each adapter implements:
```typescript
interface PlatformAdapter {
  name: string;
  matchUrls: string[];            // Which URLs this adapter handles
  extractFeedItems(data: any): FeedItem[];  // Parse platform-specific JSON
  getCardSelector(): string;       // CSS selector for feed cards
  getVideoIdFromCard(card: Element): string;
  hideCard(card: Element): void;
  reorderCards(container: Element, order: string[]): void;
  observeNewCards(callback: (card: Element) => void): MutationObserver;
}
```

---

## Part 6: What Can Go Wrong (And How We Handle It)

### 6.1 YouTube changes its DOM structure

**How often:** Minor changes every few weeks, major restructuring every 6-12 months.

**Mitigation:**
- Use semantic selectors (`ytd-rich-item-renderer`) over class-based ones
- Build a selector test suite that runs on extension startup
- If selectors break, fall back to "safe mode" (disable filtering, show a notification)
- Community-driven updates — open-source selector configs

### 6.2 YouTube changes its API response format

**Mitigation:**
- The renderer pattern (videoRenderer, richItemRenderer) has been stable for years
- Deep property access uses safe traversal (`data?.contents?.twoColumnBrowseResultsRenderer?.tabs`)
- If parsing fails, the video passes through unfiltered (fail-open, not fail-closed)

### 6.3 Performance impact

**Budget:** The extension must add < 50ms latency to feed rendering.

**How we stay fast:**
- Network interception itself is near-zero overhead (just reading cloned responses)
- Rule-based filtering (Stage 1) runs in < 1ms per video
- AI classification batches (e.g., classify 20 titles at once)
- DOM manipulation uses `requestAnimationFrame` to avoid layout thrashing
- Classification results are cached in IndexedDB (same videoId = skip classification)
- Heavy AI models run in a Web Worker (off main thread)

### 6.4 User sees a flash of unfiltered content

**Problem:** YouTube renders before our filter runs → user briefly sees unwanted videos that then disappear.

**Mitigation:**
- Run `interceptor.js` at `document_start` (before YouTube's code)
- Inject CSS early to set feed container `opacity: 0` during processing
- Fade in after filtering completes (~100-200ms)
- For continuation loads (scroll), MutationObserver fires on `childList` changes and we can hide elements within a single frame

---

## Part 7: Complete Data Flow (End to End)

```
USER opens youtube.com
    │
    ▼
Chrome loads our extension
    │
    ├── interceptor.js injected at document_start (MAIN world)
    │   └── Patches fetch() and XMLHttpRequest
    │
    ├── content.js injected at document_start (ISOLATED world)
    │   └── Loads preferences from chrome.storage.local
    │   └── Sets up MutationObserver on feed container
    │   └── Injects early-hide CSS
    │
    ▼
YouTube's code runs, calls fetch('/youtubei/v1/browse')
    │
    ▼
Our patched fetch() clones the response
    │
    ├── Original response → YouTube's code (renders normally)
    │
    └── Cloned response → postMessage to content.js
        │
        ▼
    content.js receives feed data
        │
        ▼
    extractVideoRenderers(data) → array of {videoId, title, channel, ...}
        │
        ▼
    For each video:
        │
        ├── Check IndexedDB cache (already classified?)
        │   ├── YES → use cached scores
        │   └── NO → run classification pipeline
        │       ├── Stage 1: Rule-based filter (keyword, channel, duration)
        │       ├── Stage 2: Topic classification (TF-IDF / Gemini Nano)
        │       ├── Stage 3: Clickbait detection
        │       └── Stage 4: Sentiment analysis
        │
        ▼
    Compute final score per video
        │
        ▼
    For each video:
        ├── score < hide_threshold → hideCard()
        ├── score < demote_threshold → moveCardDown()
        ├── score > boost_threshold → moveCardUp() + addBadge("Boosted")
        └── otherwise → leave in place
        │
        ▼
    Remove early-hide CSS → feed fades in
        │
        ▼
    MutationObserver watches for new cards (infinite scroll)
        └── New card added → run same pipeline on that card
        │
        ▼
    Every 24h: service-worker sends anonymized stats to backend
    On preference change: sync to cloud (encrypted)
```

---

## Part 8: What We Are NOT Doing

To be clear about scope:

| We ARE doing | We are NOT doing |
|-------------|-----------------|
| Filtering what YouTube shows you | Changing YouTube's recommendation engine |
| Re-ranking visible content | Injecting non-YouTube content into the feed |
| Classifying content locally | Training a full recommendation model |
| Syncing preferences across devices | Syncing browsing/watch history |
| Giving users topic controls | Giving users access to YouTube's algorithm internals |
| Adding explainability badges | Reverse-engineering YouTube's ranking scores |

This is a **post-filter**, not an alternative algorithm. YouTube still picks the initial candidates. We just decide which of those candidates you actually see, and in what order.
