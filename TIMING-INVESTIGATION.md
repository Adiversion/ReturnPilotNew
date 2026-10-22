# ReturnPilot — Message Chain Timing Investigation Plan

## Problem Statement

HAR shows API responses in **80–150ms** at the network level.  
Extension debug logs show the same APIs taking **400–2400ms**.  
The gap (**300–2000ms+**) is inside the extension's message chain — **not** the GST server.

We need to instrument every hop in the chain to find exactly where the time is lost.

---

## Full Message Chain (bgFetch path)

```
[popup.js]                    [background.js SW]              [GST Server]
    │                                │                              │
T0  │── chrome.runtime.sendMessage ──►│                              │
    │   (bgFetch → 'bg-fetch')        │                              │
    │                           [IPC hop 1: popup → SW]             │
T1  │                                │ (SW receives message)        │
    │                                │                              │
T2  │                                │── resolveAuthToken() ────────│
    │                                │   - check in-memory cache    │
    │                                │   - chrome.storage.session   │
    │                                │   - chrome.cookies.get() x3  │
T3  │                                │◄─ token resolved ────────────│
    │                           [auth token overhead]                │
T4  │                                │── fetch(url) ────────────────►│
T5  │                                │◄── HTTP response ─────────────│
    │                           [actual network time ~80-150ms]      │
T6  │                                │── sendResponse() called       │
    │◄── bgFetch promise resolves ───│                              │
T7  │   (API_RESP logged in popup)   │                              │
    │                           [IPC hop 2: SW → popup]             │
```

---

## Timing Points Instrumented

| # | Location | Log Label | Measures |
|---|---|---|---|
| T0 | `popup.js processAsync` start | `API_REQ` (existing) | Full round-trip start |
| T1 | `background.js handleBgFetch` entry | `BG_RECV` | **IPC hop 1: popup → SW** (T1 - T0) |
| T2 | `background.js resolveAuthToken` start | (inline) | Auth overhead start |
| T3 | `background.js resolveAuthToken` end | `T2→T3 AUTH` | **Auth token cost** (T3 - T2) |
| T4 | `background.js fetch()` start | `BG_FETCH_START` | Fetch initiated |
| T5 | `background.js fetch()` response | `BG_FETCH_DONE` | **Real network time** (T5 - T4) |
| T6 | `background.js sendResponse` called | `BG_SEND_RESP` | Total SW processing (T6 - T1) |
| T7 | `popup.js bgFetch` resolves | `API_RESP` (existing) | **IPC hop 2: SW → popup** (T7 - T6) |

---

## How to Capture Logs

1. Pull latest and reload the extension in `chrome://extensions`
2. Open popup on the GST portal and let it run
3. Open **SW DevTools**: `chrome://extensions` → ReturnPilot → **"service worker"** → Console
4. Filter console by: **`RP_TIMING`**

You'll see output like:
```
[RP_TIMING] T1 BG_RECV: message arrived in SW for https://.../formdetails?rtn_prd=042026...
[RP_TIMING] T2→T3 AUTH: cache hit in 0ms
[RP_TIMING] T4 BG_FETCH_START: fetch() fired for https://.../formdetails?rtn_prd=042026...
[RP_TIMING] T5 BG_FETCH_DONE: 200 in 84ms for https://.../formdetails?rtn_prd=042026...
[RP_TIMING] T6 BG_SEND_RESP: SW done for https://.../formdetails?rtn_prd=042026... | total SW time: 91ms
```

Then compare with `API_RESP` in the **extension debug log** (popup console).  
**Gap = `API_RESP` elapsed - T6 total SW time = IPC hop 2 (SW → popup).**

---

## Three Hypotheses (in order of likelihood)

### Hypothesis 1 — `resolveAuthToken` cookie waterfall on cache miss ⭐ Most Likely

**Auth token cache TTL is only 30 seconds.** When it expires, `resolveAuthToken` does:
1. `chrome.storage.session.get(...)` — async storage I/O
2. `chrome.cookies.get({ url: msg.url })` — cookie lookup #1
3. `chrome.cookies.get({ url: 'https://services.gst.gov.in' })` — cookie lookup #2
4. `chrome.cookies.get({ url: 'https://return.gst.gov.in' })` — cookie lookup #3

These are **sequential awaits**, not parallel. If 3 requests fire simultaneously and all miss the cache:
- All 3 race to `resolveAuthToken` — the shared `cachedAuthToken` variable isn't set yet for any of them
- Each independently falls through to 3 cookie lookups = **9 total sequential cookie API calls**
- Each cookie lookup: 30–200ms → worst case **~600ms** just for auth token

**Fix:** 
- Extend TTL from 30s → 5 minutes
- Parallelise the 3 cookie lookups with `Promise.all`
- Coalesce concurrent calls with a shared pending promise

### Hypothesis 2 — IPC hop 1: SW cold start

Manifest V3 service workers are **terminated when idle** (typically after 30s of no activity).  
When the popup opens and fires the first message, Chrome restarts the SW: **100–500ms cold start**.  
Subsequent requests in the same session should be fast (SW stays alive during active use).

**Evidence:** Only affects the first batch of requests per popup open, not subsequent ones.

**Fix:** Add a `chrome.runtime.sendMessage({ request: 'ping' })` at popup startup to wake the SW before the first real API call.

### Hypothesis 3 — IPC hop 2: popup event loop contention

The popup's `bgFetch` promise resolves on the popup's JS main thread.  
If the popup is busy doing DOM updates (pill renders, table injection), the incoming message callback gets queued.

**Evidence:** Would explain why the 3rd concurrent request (which fires after 2 DOM updates from earlier responses) is slower.

**Fix:** Already partially addressed — use `setTimeout(0)` or `queueMicrotask` to yield between DOM updates.

---

## Fix Plan (apply after logs confirm which hypothesis)

### Fix A — Extend auth token TTL + parallel cookie lookups
```js
// background.js
const AUTH_TOKEN_CACHE_TTL = 300000; // 5 minutes (was 30s)

// Parallel cookie lookups instead of sequential:
const [c1, c2, c3] = await Promise.all([
  chrome.cookies.get({ url: msg.url, name: 'AuthToken' }),
  chrome.cookies.get({ url: 'https://services.gst.gov.in', name: 'AuthToken' }),
  chrome.cookies.get({ url: 'https://return.gst.gov.in', name: 'AuthToken' })
]);
const cookie = c1 || c2 || c3;
```

### Fix B — Coalesce concurrent resolveAuthToken calls
```js
let _resolveAuthTokenInflight = null;

async function resolveAuthToken(msg) {
  if (cachedAuthToken && (Date.now() - cachedAuthTokenTs < AUTH_TOKEN_CACHE_TTL)) {
    return cachedAuthToken;
  }
  if (!_resolveAuthTokenInflight) {
    _resolveAuthTokenInflight = _doResolveAuthToken(msg)
      .finally(() => { _resolveAuthTokenInflight = null; });
  }
  return _resolveAuthTokenInflight;
}
```

### Fix C — SW warm-up ping at popup boot
```js
// popup.js — early in startupAsync(), before any processAsync calls
chrome.runtime.sendMessage({ request: 'ping' }, () => { chrome.runtime.lastError; });
await new Promise(r => setTimeout(r, 50)); // give SW 50ms to wake
```

---

## Current Status

- [x] Added T1–T6 timing logs in `background.js` (commit `56e5f38`)
- [x] Integrated `RP_TIMING` with `core/logger.js` telemetry pipeline & Flight Recorder
- [x] Added `Timing ⏱️` filter button & latency metric badges to Popup Dev Diagnostics Drawer
- [x] Implemented cross-context timing telemetry relay (`_timing` payload + `rpLog.timingChain` breakdown)
- [x] Captured user live debug logs (`ReturnPilot-Debug-Logs-1789568602204.txt` & `1789568726784.txt`)
- [x] Identified bottleneck: IPC overhead is negligible (Hop 1 <= 2ms, Hop 2 <= 2ms, SW Auth = 0ms cache hit); 98%+ of duration is remote GST Portal wire latency
- [x] Applied targeted SW optimizations:
  - Auth token TTL extended to 5 minutes (`300000ms`)
  - Inflight request coalescing (`_resolveAuthTokenPromise`) & parallel cookie lookups (`Promise.all`)
  - Chunked Uint8Array buffer conversion (32KB chunks via `String.fromCharCode.apply`)
  - O(1) 256-byte slice for HTML redirect detection (zero full-payload string copying)
  - Service Worker boot warm-up ping in `popup.js` `DOMContentLoaded`
- [x] Built SaaS-grade production packaging pipeline:
  - `core/logger.js` and all dev drawers 100% excluded from `dist/` builds
  - Terser pure-function dead-code elimination for all `rpLog.*` and `logTelemetry` calls
  - Automated HTML & SW script reference stripping (zero broken script tags, zero errors in `chrome://extensions`)
  - Verified across all 5 verification tiers with 0 errors and 0 skips (Playwright real Chromium smoke test passed)
