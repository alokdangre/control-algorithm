# AlgoControl: AI-Powered Chrome Extension for User-Controlled Algorithms

## Vision

A Chrome extension that puts users in control of their own social media algorithms across platforms (X/Twitter, YouTube, Instagram, and more) using an AI navigator. Instead of being passive consumers of opaque recommendation engines, users define *what* they want to see, *how much* of it, and *why* — and the AI agent enforces those preferences in real time across every platform they visit.

---

## 1. What Is This?

AlgoControl is a cross-platform Chrome extension that:

- **Intercepts** recommendation feeds on YouTube, X, Instagram, and other platforms at the DOM/network level
- **Analyzes** incoming content using on-device or API-based AI (classification, sentiment, topic detection)
- **Filters, re-ranks, or replaces** content based on user-defined rules and preferences
- **Provides an AI Navigator** — a conversational interface where users describe what they want ("show me more indie music, less political outrage") and the AI translates that into actionable filter/ranking rules
- **Works across platforms** with a unified preference model, so your "algorithm" follows you everywhere

---

## 2. Why This Is Possible Now

### 2.1 Platforms Are Already Moving Toward User Control

Platforms themselves are beginning to offer algorithmic control features, proving market demand and technical feasibility:

| Platform | Feature | What It Does |
|----------|---------|--------------|
| **Instagram** | "Your Algorithm" (2025) | Shows users what topics the AI thinks they like; users can increase/decrease each topic. Most transparent algorithmic control any major platform has offered. |
| **YouTube** | "Your Custom Feed" (testing) | Users update algorithmic recommendations through conversational prompts. |
| **X (Twitter)** | Grok-based feed tuning | Users adjust their feed dynamically by asking Grok. "Show me more tech, less politics." |
| **Threads** | @threads.algo | Users tag @threads.algo in a post to change what they see. |

**Sources:**
- [Instagram gives users direct control over Reels algorithm](https://www.techbuzz.ai/articles/instagram-gives-users-direct-control-over-reels-algorithm)
- [YouTube Tests New Feed Control Options](https://www.socialmediatoday.com/news/youtube-tests-new-feed-control-options/806369/)
- [What would happen if you could talk directly to the recommendation algorithm? X is about to find out](https://www.tubefilter.com/2025/09/22/recommendation-algorithm-x-twitter-youtube-grok-ai-changes/)

**Key Insight:** Each platform is building its *own* silo of control. AlgoControl unifies this into a single, user-owned layer.

### 2.2 Open-Source Algorithms Exist

- **X/Twitter** open-sourced its full recommendation algorithm on GitHub (`xai-org/x-algorithm`), written in Rust and Python. It narrows 500M daily tweets to ~1,500 candidates per user in under 1.5 seconds.
- This means we can *understand* how these algorithms work and build counter-algorithms or complementary filters.

**Sources:**
- [X open sources its algorithm (TechCrunch)](https://techcrunch.com/2026/01/20/x-open-sources-its-algorithm-while-facing-a-transparency-fine-and-grok-controversies/)
- [GitHub: twitter/the-algorithm](https://github.com/twitter/the-algorithm)
- [X Algorithm Explained: How the Open Source Recommendation System Works](https://singhajit.com/system-design/x-twitter-for-you-algorithm/)

### 2.3 Chrome Extension Technology Is Mature

- **Manifest V3** provides content scripts that can read and modify the DOM of any webpage
- **XHR/Fetch interception** allows catching platform API responses before they render (FilterTube already does this for YouTube)
- **Service workers** enable background processing without persistent memory overhead
- Extensions like **Unhook** (1M+ users) already successfully strip YouTube recommendations, proving DOM manipulation at scale is viable

**Sources:**
- [Building Chrome Extensions in 2026: A Practical Guide with Manifest V3](https://dev.to/ryu0705/building-chrome-extensions-in-2026-a-practical-guide-with-manifest-v3-12h2)
- [Chrome Extensions and AI (developer.chrome.com)](https://developer.chrome.com/docs/extensions/ai)
- [Unhook - Chrome Web Store](https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid)

### 2.4 AI Capabilities Are Ready

- **On-device AI** via Chrome's built-in AI APIs (Gemini Nano) enables local inference without sending data to servers
- **Browser-use agents** (Nanobrowser, HARPA AI) already demonstrate multi-agent AI workflows inside the browser
- **LLM-based content classification** can categorize posts by topic, sentiment, toxicity, and engagement-bait patterns in real time

**Sources:**
- [Nanobrowser: Privacy-First Chrome Extension for AI Automation](https://www.blog.brightcoding.dev/2025/09/30/nanobrowser-the-100-free-privacy-first-chrome-extension-that-turns-your-browser-into-an-ai-automation-engine/)
- [HARPA AI Browser Agent](https://harpa.ai/)
- [Top 15 Agentic AI Chrome Extensions (DataCamp)](https://www.datacamp.com/blog/top-agentic-ai-chrome-extensions)

---

## 3. What the User Can Control

### 3.1 Content Filtering & Ranking

| Control | Description |
|---------|-------------|
| **Topic Preferences** | "More science, less celebrity gossip" |
| **Sentiment Control** | "Reduce outrage-bait, increase uplifting content" |
| **Source Filtering** | Block/boost specific accounts, channels, or publications |
| **Engagement-Bait Detection** | AI identifies and demotes clickbait, rage-bait, and manipulation patterns |
| **Freshness Control** | Prefer recent content vs. algorithmic "best of" recycling |
| **Diversity Injection** | Deliberately surface perspectives outside your bubble (inspired by Gobo's "politics slider") |

### 3.2 Platform-Specific Controls

| Platform | Controls |
|----------|----------|
| **YouTube** | Hide Shorts, filter recommendations by topic/duration/channel, disable autoplay, remove "suggested" sidebar |
| **X/Twitter** | Switch between algorithmic and chronological feed, filter by topic/sentiment, mute engagement-bait patterns |
| **Instagram** | Control Reels algorithm topics, filter Explore page, reduce suggested posts in feed |
| **Future: Reddit, LinkedIn, TikTok** | Extensible platform adapter architecture |

### 3.3 AI Navigator (Conversational Interface)

Instead of complex settings panels, users talk to an AI:

- "I'm studying for exams, only show me educational content this week"
- "I want to see more local news and less national politics"
- "Show me why this post was recommended to me"
- "Make my YouTube like it was in 2018 — subscriptions only"

The AI translates natural language into filter rules and applies them in real time.

---

## 4. User Benefits (With Evidence)

### 4.1 Mental Health Protection

**Problem:** Social media algorithms optimize for engagement, not wellbeing. This causes measurable harm.

**Evidence:**
- 5 weeks off Facebook/Instagram improved wellbeing and reduced anxiety and depression — especially for Facebook users over 35 and Instagram users under 25 (study cited by ACP)
- 70% of teenagers in a survey of 10,000+ encountered real-world violence on social media; 25% said the content was *algorithmically promoted*, not sought
- Social media algorithms push extreme content to vulnerable youth, linked to increases in eating disorders, poor body image, and suicidality

**How AlgoControl helps:** Users can demote harmful content patterns, set "focus modes" during vulnerable times, and get AI-powered warnings about potentially harmful algorithmic patterns.

**Sources:**
- [Social Media Algorithms and Mental Health (ACP)](https://acp-mn.com/about-acp/blog/social-media-algorithms-and-mental-health/)
- [Algorithms, Addiction, and Adolescent Mental Health (Cambridge)](https://www.cambridge.org/core/journals/american-journal-of-law-and-medicine/article/algorithms-addiction-and-adolescent-mental-health/)
- [The Empathy Crisis: How Social Media Algorithms Drive Emotional Numbing (Psychiatric Times)](https://www.psychiatrictimes.com/view/the-empathy-crisis-how-social-media-algorithms-drive-emotional-numbing)

### 4.2 Reclaiming Attention

**Problem:** The attention economy is an extraction industry.

**Evidence:**
- Average American spends 5+ hours/day on phone, unlocking it ~96 times/day
- Notifications arrive every 2 minutes during the workday
- 86% of Gen Z is actively trying to reduce screen time
- Digital wellness apps are among the fastest-growing app categories

**How AlgoControl helps:** AI-powered attention budgeting — "I want to spend max 30 minutes on YouTube today, prioritize my subscriptions." The AI navigator can enforce time-based content strategies.

**Sources:**
- [Digital Minimalism in 2026: Reclaiming Your Attention](https://www.graygroupintl.com/blog/digital-minimalism-2026/)
- [Top 20 User Attention Span Statistics 2026](https://www.amraandelma.com/user-attention-span-statistics/)

### 4.3 Breaking Filter Bubbles

**Problem:** Algorithms create echo chambers by showing you more of what you already engage with.

**Evidence:**
- MIT Media Lab's Gobo project demonstrated that users *want* tools to break filter bubbles — their "politics slider" deliberately surfaces perspectives from outside a user's network
- Research shows algorithmically-driven polarization reduces empathy and increases emotional numbing

**How AlgoControl helps:** A "diversity dial" that injects content from sources you wouldn't normally see, with AI explaining *why* it's showing you different perspectives.

**Sources:**
- [Gobo: A System for Exploring User Control of Invisible Algorithms (MIT Media Lab)](https://www.media.mit.edu/publications/gobo-a-system-for-exploring-user-control-of-invisible-algorithms-in-social-media/)
- [Who Filters Your News? Why we built gobo.social (Ethan Zuckerman)](https://ethanzuckerman.com/2017/11/16/who-filters-your-news-why-we-built-gobo-social/)
- [Gobo 2.0: All Your Social Media in One Place](https://publicinfrastructure.org/2022/11/09/gobo-2-0-all-your-social-media-in-one-place/)

### 4.4 Transparency & Understanding

**Problem:** Users don't know *why* they see what they see.

**Evidence:**
- EU Digital Services Act (DSA) now *requires* platforms with 45M+ EU users to offer non-personalized feeds and disclose how their algorithms work
- Research from arxiv shows transparency can reduce algorithm aversion and increase user trust
- X was fined by the EU in December 2025 for non-compliance with DSA transparency requirements

**How AlgoControl helps:** Every piece of filtered/promoted content gets an explainability tag: "Shown because: matches your 'science' preference" or "Demoted because: detected as engagement-bait."

**Sources:**
- [Digital Services Act: keeping us safe online (European Commission)](https://commission.europa.eu/news-and-media/news/digital-services-act-keeping-us-safe-online-2025-09-22_en)
- [A guide to the Digital Services Act (AlgorithmWatch)](https://algorithmwatch.org/en/dsa-explained/)
- [Overcoming Algorithm Aversion with Transparency (arxiv)](https://arxiv.org/pdf/2508.03168)
- [State of the Evidence: Algorithmic Transparency (Open Government Partnership)](https://www.opengovpartnership.org/wp-content/uploads/2023/05/State-of-the-Evidence-Algorithmic-Transparency.pdf)

### 4.5 Parental & Educational Controls

**Problem:** ~$11 billion in ad revenue is generated annually from ads targeted at users aged 0-17.

**How AlgoControl helps:** Parents can set algorithm profiles for children — "educational content only," "no violent recommendations," "1 hour daily limit with gradually expanding diversity."

**Sources:**
- [MHA Report on Social Media and Youth Mental Health](https://mhanational.org/news/mha-issues-new-report-on-social-media-and-youth-mental-health/)

### 4.6 Productivity & Focus

**How AlgoControl helps:** Context-aware modes:
- "Work mode" — only professional content on LinkedIn, no YouTube shorts
- "Study mode" — educational content only, across all platforms
- "Relaxation mode" — comfort content, no news, no outrage

---

## 5. Existing Tools & Competitive Landscape

| Tool | What It Does | Limitation AlgoControl Solves |
|------|-------------|-------------------------------|
| **Unhook** (1M+ users) | Removes YouTube recommendations/shorts | YouTube only; removes, doesn't re-rank; no AI |
| **FilterTube** | Filters YouTube by keywords/channels | YouTube only; keyword-based, not semantic |
| **Gobo (MIT)** | Cross-platform feed aggregator with filters | Web app, not extension; limited to Twitter/Facebook; not actively maintained |
| **YouTube Recommendation Modifier** | Filter YouTube homepage | Basic keyword filtering; single platform |
| **Social Feed Blocker** | Blocks social media feeds entirely | Nuclear option — blocks everything, no intelligence |
| **Platform native controls** | Instagram "Your Algorithm", YouTube "Custom Feed" | Siloed per platform; limited controls; platform controls what you can control |

**AlgoControl's differentiator:** Cross-platform, AI-powered, user-owned, conversational interface, privacy-first.

**Sources:**
- [Unhook](https://unhook.app/)
- [FilterTube](https://www.filtertube.in/)
- [GitHub: Gobo (MIT Media Lab)](https://github.com/mitmedialab/gobo)
- [GitHub: YouTube Recommendation Modifier](https://github.com/vaibhavgarg237/Youtube-Recommendation-Modifier)
- [GitHub: Social Feed Blocker](https://github.com/ganganimaulik/social-feed-blocker)

---

## 6. Technical Feasibility

### 6.1 Architecture Overview

```
User <-> AI Navigator (popup/sidebar)
              |
     Preference Engine (stores rules, profiles, schedules)
              |
     Platform Adapters (content scripts per platform)
        |         |         |         |
     YouTube    X/Twitter  Instagram  ...more
        |         |         |         |
     DOM Manipulation + XHR Interception
```

### 6.2 How It Works Per Platform

1. **Content script** injects into the platform page
2. **XHR/Fetch interceptor** catches API responses containing feed data (before rendering)
3. **AI classifier** analyzes each item (topic, sentiment, engagement-bait score)
4. **Preference engine** applies user rules (filter, re-rank, tag)
5. **DOM manipulator** modifies the rendered feed (hide, reorder, add explainability badges)
6. **AI Navigator** provides conversational interface for rule creation and feed explanation

### 6.3 Proven Patterns

- **FilterTube** already intercepts YouTube's `/youtubei/v1/next`, `/browse`, and `/player` JSON responses
- **Unhook** already hides 10+ YouTube UI elements via DOM manipulation
- **Nanobrowser** already runs multi-agent AI workflows inside Chrome
- **HARPA AI** already combines multiple LLMs with web automation

### 6.4 Privacy Architecture

- All content analysis happens **locally** (on-device AI via Chrome's Gemini Nano APIs, or user-provided API keys)
- No feed data is sent to AlgoControl servers
- User preferences stored locally in `chrome.storage.local`
- Optional encrypted sync via user's own cloud storage

---

## 7. Phased Rollout Strategy

### Phase 1: YouTube (Proven Ground)
- DOM manipulation and XHR interception (proven by Unhook, FilterTube)
- Basic keyword/channel/topic filtering
- AI-powered content classification
- Simple preference UI

### Phase 2: X/Twitter
- Leverage open-source algorithm knowledge
- Chronological vs. algorithmic feed toggle
- Sentiment and engagement-bait filtering
- AI Navigator v1 (conversational rule creation)

### Phase 3: Instagram
- Reels and Explore page filtering
- Topic-based content control
- Cross-platform unified preferences

### Phase 4: Expansion
- Reddit, LinkedIn, TikTok, Facebook
- Advanced AI features (proactive recommendations, attention budgeting)
- Community-shared filter profiles ("import a creator's algorithm preferences")

---

## 8. Market Opportunity

- AI Chrome extension market: **$2.3 billion** (2025), growing at **22.5% CAGR** through 2035
- 442 AI extensions with 1,000+ users, downloaded **115.5 million times** combined
- Unhook alone has **1M+ users** — proving demand for just *one* platform's feed control
- **86% of Gen Z** actively trying to reduce screen time
- **EU DSA** creates regulatory tailwind — platforms must offer non-personalized feeds, creating user expectation for control
- Digital wellness apps are among the **fastest-growing** app categories

**Sources:**
- [AI Chrome Extensions Privacy Rankings 2026 (Incogni)](https://blog.incogni.com/chrome-extensions-privacy-2026/)
- [How To Build Million-Dollar AI Chrome Extensions (Info With AI)](https://infowithai.com/ai-money/build-ai-chrome-extension/)

---

## 9. Regulatory Tailwind

The legal environment is moving in favor of user algorithm control:

| Regulation | Impact |
|-----------|--------|
| **EU Digital Services Act (DSA)** | Platforms must offer non-personalized feeds; disclose algorithm mechanics; ban dark patterns |
| **EU ECAT** | European Centre for Algorithmic Transparency provides enforcement and research |
| **US state laws** | Multiple states considering/passing legislation restricting algorithmic recommendations for minors |
| **X's DSA fine (Dec 2025)** | Platforms are being held accountable for transparency failures |

AlgoControl positions itself as the user-side tool that *complements* regulation — even as platforms are forced to offer some control, AlgoControl provides a unified, AI-powered layer on top.

**Sources:**
- [EU Digital Services Act (Wikipedia)](https://en.wikipedia.org/wiki/Digital_Services_Act)
- [EU Digital Policy 2025-2026 (IIEA)](https://www.iiea.com/blog/the-transition-to-a-new-digital-policy-agenda-eu-digital-policy-2025-2026)
- [DSA Explained (AlgorithmWatch)](https://algorithmwatch.org/en/dsa-explained/)

---

## 10. Risks & Challenges

| Risk | Mitigation |
|------|-----------|
| **Platform DOM changes break extension** | Platform adapter architecture isolates changes; community-driven rapid updates |
| **Platforms actively block extensions** | Content script detection is difficult for platforms; Manifest V3 sandboxing helps |
| **AI classification accuracy** | Start with high-confidence categories; let users correct misclassifications (feedback loop) |
| **Performance overhead** | Lazy evaluation; only process visible viewport items; use Web Workers for AI inference |
| **Privacy concerns** | All processing local; no data exfiltration; open-source for auditability |
| **Legal/ToS issues** | Extensions that modify DOM are widely accepted (uBlock, Unhook have millions of users); no API abuse |
| **Manifest V3 limitations** | No remote code execution; all AI models bundled or via user-provided API keys; no eval() |

---

## 11. Key References & Research Papers

- [Gobo: A System for Exploring User Control of Invisible Algorithms in Social Media (MIT Media Lab Paper)](https://web.media.mit.edu/~gaikwad/assets/publications/cscw-gobo.pdf)
- [What Are You Hiding? Algorithmic Transparency and User Perceptions (arxiv)](https://arxiv.org/pdf/1812.03220)
- [Polarizing Effects of Algorithmic Transparency (arxiv)](https://arxiv.org/pdf/1811.02163)
- [Algorithmic Transparency and Accountability (Council of Europe)](https://rm.coe.int/iris-special-2023-02en/1680aeda48)
- [This is Transparency to Me: User Insights into Recommendation (CDT Report)](https://cdt.org/wp-content/uploads/2022/10/algorithmic-transparency-ux-final-100322.pdf)
- [The Dark Side of Social Media: Recommender Algorithms and Mental Health (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5130959)
- [JRC Science for Digital Wellbeing (EU Joint Research Centre)](https://joint-research-centre.ec.europa.eu/projects-and-activities/jrc-science-digital-wellbeing_en)
- [Navigating well-being in the digital era (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2666558126000011)
- [Social networks are broken. This man wants to fix them. (MIT Technology Review)](https://www.technologyreview.com/2018/02/09/3406/social-networks-are-broken-this-man-wants-to-fix-them/)

---

## 12. Open-Source Projects to Study

| Project | URL | Relevance |
|---------|-----|-----------|
| X Recommendation Algorithm | https://github.com/twitter/the-algorithm | Understand how a major platform's algorithm works |
| Gobo (MIT Media Lab) | https://github.com/mitmedialab/gobo | Cross-platform feed aggregation with user-controlled filters |
| FilterTube | https://github.com/varshneydevansh/FilterTube | YouTube XHR interception and DOM filtering techniques |
| Unhook | https://github.com/lawrencehook/remove-youtube-suggestions | YouTube DOM manipulation at scale (1M+ users) |
| YouTube Recommendation Modifier | https://github.com/vaibhavgarg237/Youtube-Recommendation-Modifier | YouTube homepage filtering |
| Social Media Collector | https://github.com/AlgorithmicTransparencyInstitute/social-media-collector | Data collection for algorithmic transparency research |
| Nanobrowser | https://github.com/nanobrowser/nanobrowser | Open-source AI browser agent with multi-agent workflows |
| Open-Source Social Media Algorithm | https://github.com/HandleMode/Social-Media-Algorithm | Alternative open algorithm for social media |
| Reach Optimizer (X Algorithm) | https://dev.to/aytuncyildizli/i-reverse-engineered-xs-open-source-algorithm-into-a-chrome-extension-that-predicts-your-reach-5hmd | Reverse-engineered X algorithm in a Chrome extension |
