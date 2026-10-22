# ReturnPilot — Architecture & Technical Integration Guide

This document contains the complete technical blueprint for **ReturnPilot** (v4.2), including build instructions, architectural patterns, and decision frameworks for extending or upgrading GST Portal downloaders.

## Active refactor handoff (2026-10-22)

**Read [docs/download-refactor.md](docs/download-refactor.md) before continuing the download-engine refactor.**

**New portal evidence:** see [docs/portal-recording-analysis.md](docs/portal-recording-analysis.md)
for the reviewed `2b download/` and `3B Download/` uploads. Raw captured functions
show 2B compiles from service-cached data, while 3B's dashboard entry method loads
API data. Generated architecture summaries contain inaccuracies; do not follow
them blindly. The 2B response bodies needed for data-readiness verification are
missing. The 3B HAR includes an unredacted authentication header: sanitize evidence
and address session/history exposure before sharing it further. No raw recordings
are used as test fixtures.

**End-of-flow follow-up:** [docs/portal-evidence-followup.md](docs/portal-evidence-followup.md)
records additional findings in the later ES5 source captures: GSTR-2B Excel Read me
identity cells, JSON-refresh/multipart export paths, and GSTR-3B response identity
fields. This qualifies the earlier cache-only description. Recorder “completed”
labels are not browser download acknowledgements; source function names alone do
not establish a callable live service. This review changes documentation only.



- Phase 1 implemented: immutable jobs, shared scheduling, readiness lifecycle,
  session invalidation and cleanup safety in `engine/download-coordinator.js`.
- The coordinator is **not connected to live engines yet**. Do not claim
  production cross-engine serialization or data readiness has been fixed.
- Phase 2a implemented in the production GSTR-2B path: extracted frame runner,
  exact source-window/origin checks, unique request IDs, matching result metadata,
  single-use parent-owned start messages, and timer/listener cleanup.
- Phase 2b implemented: native output observation now requires activation of an
  owned nonempty blob anchor of the requested format. PDF/saveAs invocation and
  object URL creation no longer count as dispatch. Timeouts reject rather than
  falling through to success. PDF selection skips Excel buttons and honors ARIA
  busy/disabled state. Removed obsolete capture helpers and filename traps.
- Phase 2c implemented: shared labelled-header identity guard before PDF
  compilation for GSTR-2B and GSTR-3B. Checks return title, taxpayer, month and
  financial year against the job, before 2B metadata correction. Unknown or
  mismatched headers fail closed; 3B fallback capture cannot bypass the check.
  This does NOT validate every amount, Excel contents or eliminate shared-state races.
- Verified: 56 focused tests (11 coordinator, 10 frame, 16 output, 12 identity/loader,
  7 production 3B identity integration), 16 architecture checks and 12 static
  compliance checks. Offline matching/cross-month checks also passed against all
  four supplied PDF header layouts without copying sensitive data into fixtures.
  Live GST downloads and the full build/browser pipeline have not been verified.
- Next: implement GSTR-2B data readiness, safe download handoff and context cleanup
  before connecting the coordinator. Frame teardown now follows observed native
  anchor activation; this is still not proof of browser download completion.
  Non-anchor native output paths currently fail closed and require live testing.
  Address worker restarts, account switches and caller timeouts per the handoff.
- Commands: `npm run test:coordinator`, `npm run test:gstr2b-frame`, `npm run test:gstr2b-output`,
  `npm run test:pdf-identity`,
  `node tests/run-e2e.js`, `node scripts/verify-webstore-compliance.js`.
- Workflow requested by owner: after each successful tested milestone, update
  handoff documentation, commit, and push to `arena/e6eb8dc6-returnpilotnew`.
  Never switch branches. Record verification limitations rather than assuming
  static tests prove live portal behavior.

The architecture guide below includes historical descriptions and local paths;
current executable code and the handoff above take precedence where they differ.

---

## Focused user-run diagnostic

Use [the safe recorder guide](docs/safe-recorder-guide.md) with
[`tools/gst-safe-download-recorder.js`](tools/gst-safe-download-recorder.js) for
small comparison-only reports from an authorized session. This optional console
tool makes no new network requests and exports no raw taxpayer/response/header
values. It is not part of the production extension. Six synthetic recorder tests
pass (`npm run test:safe-recorder`); live compatibility remains unverified.

## 1. Environment & Build Instructions

### Prerequisites
- **Node.js:** v18.0.0 or higher (LTS recommended)
- **Package Manager:** npm v9.0.0 or higher

### Commands
```bash
# Install dependencies
npm install

# Run syntax and validation check
node --experimental-vm-modules scratch/check_syntax.js

# Build production bundle
npm run build
```

---

## 2. Technical Architecture Patterns for GST Portal Integration

When adding new downloaders or upgrading existing return modules (e.g., GSTR-1, GSTR-1A, GSTR-2A, GSTR-2B, GSTR-3B, GSTR-9, GSTR-9C, IMS, or E-Way / E-Invoice), select the pattern matching the target portal subdomain and Angular architecture.

```
                     ┌─────────────────────────────────────────────────────────┐
                     │   Which GST Portal Module Are You Upgrading / Adding?   │
                     └────────────────────────────┬────────────────────────────┘
                                                  │
            ┌─────────────────────────────────────┼─────────────────────────────────────┐
            ▼                                     ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐             ┌───────────────────────┐
│ Client Hash Routes    │             │ Standalone Portal App │             │ Return Portal Forms   │
│ (e.g. GSTR-1A, IMS)   │             │ (e.g. GSTR-2B, FOGSTR)│             │ (GSTR-1, GSTR-9, 3B)  │
└───────────┬───────────┘             └───────────┬───────────┘             └───────────┬───────────┘
            │                                     │                                     │
            ▼                                     ▼                                     ▼
    [ STRATEGY 1 ]                        [ STRATEGY 2 ]                        [ STRATEGY 3 / 4 ]
 Direct Hash Route Load                 Hidden Form POST +                  Persistent Iframe Reuse /
 + Scope Tree Hydration                 State Pre-Seeding                   Active Tab Scope Call
```

---

### Strategy 1: Direct Hash-Route Navigation (`Hash-Route / SPA Deep Linking & Warm Runner`)

#### When to Use:
- The return module uses **AngularJS `$routeProvider`** or **Angular Router with HashLocationStrategy** (e.g., `https://gstr1a.gst.gov.in/r1Aweb/auth/gstr1a#/auth/gstr1a/gstr1sum`).
- Landing page parameters can be pre-configured, and the UI view is reachable directly via its URL hash.
- Multi-PDF pages (such as GSTR-1A where both **Standalone** `[DOWNLOAD GSTR-1A SUMMARY (PDF)]` and **Consolidated** `[DOWNLOAD CONSOLIDATED SUMMARY (PDF)]` live on the exact same summary view).

#### Technical Workflow:
1. **Parallel Cold Start**: Background engine initiates parallel execution:
   - Hidden iframe loads `https://gstr1a.gst.gov.in/r1Aweb/auth/gstr1a#/auth/gstr1a/gstr1sum`.
   - Fetches Form Details API (`https://return.gst.gov.in/returns/auth/api/formdetails?...`) and Role Status in parallel.
2. **State & Scope Hydration**: Injected MAIN-world script receives `INJECT_START` postMessage:
   - Sets `localStorage` and `sessionStorage` keys (`rtn_prd`, `fin_year`, `gstin`, `stat`, `uPref`).
   - Traverses Angular scopes via `$rootScope` and updates `shareData` and controller scopes.
   - Hydrates target button scope directly (`hydrateButtonScope(btn, meta)`).
3. **Button Driving & Blob Interception**:
   - Locates target button via exact text/attribute matcher (`generateGSTR1APdf()` vs `genratepdfNew()`).
   - Clicks button -> `pdfMake.createPdf` hook intercepts the generated binary blob.
   - Converts blob to Data URL -> sends back via `window.postMessage` / `chrome.runtime.sendMessage`.
4. **Warm Runner Instant Reuse (~4x Speedup)**:
   - Iframe remains alive in the DOM for subsequent downloads.
   - Next request pings the iframe (`INJECT_PING` ➔ `INJECT_PONG` in ~10ms).
   - Skips Angular route rebuild and `sumryData` fetch; executes the next PDF in **under 300–600ms**!

#### Reference Implementation:
- Inject Script: [`content/gstr1a-inject.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/content/gstr1a-inject.js)
- Content Script Bridge: [`content/gstr1a-contentscript.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/content/gstr1a-contentscript.js)
- Background Engine: [`engine/gstr1a-pdf-portal.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/engine/gstr1a-pdf-portal.js)

---

### Strategy 2: Hidden Form POST + State Pre-Seeding (`SPA Bootstrap`)

#### When to Use:
- The return module is a **separate micro-frontend / Angular Ivy app** that expects a server-side or POST-based handshake to initialize state (e.g., `https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary`).
- Direct GET requests or missing session variables result in redirection to login or empty grids.

#### Technical Workflow:
1. **Cookie Propagation**: Service worker syncs all `domain: 'gst.gov.in'` authentication cookies to the target subdomain (`gstr2b.gst.gov.in`).
2. **Form POST Submission**:
   ```javascript
   const form = document.createElement('form');
   form.method = 'POST';
   form.action = 'https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary';
   form.target = iframeName; // Hidden iframe name with embedded meta
   [['finyr', finyr], ['rtnprd', period], ['form', 'GSTR2B'], ['gstin', gstin]].forEach(([n, v]) => {
       const i = document.createElement('input');
       i.type = 'hidden'; i.name = n; i.value = v || '';
       form.appendChild(i);
   });
   document.body.appendChild(form);
   form.submit();
   form.remove();
   ```
3. **Content Script Pre-population (`document_start` / `document_end`)**:
   - `content/2b-contentscript.js` runs with `all_frames: true`.
   - Parses `window.name` and pre-seeds both `localStorage` and `sessionStorage` with 20+ portal state keys (`rtn_prd`, `finyr`, `gstin`, `lgnm`, `uPref`, etc.) before the Angular bundle boots.
4. **Binary Capture & FY Correction**:
   - `content/2b-inject.js` installs `fixPdfDocDefinition(node, targetFY)` onto `pdfMake.createPdf` to fix missing Financial Year headers.
   - Separate PDF (`waitButton([PDF_PATTERNS])`) and Excel (`waitButton([EXCEL_PATTERNS])`) execution branches ensure zero cross-firing.

#### Reference Implementation:
- Inject Script: [`content/2b-inject.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/content/2b-inject.js)
- Content Script Bridge: [`content/2b-contentscript.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/content/2b-contentscript.js)
- Background Engine: [`engine/gstr2b.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/engine/gstr2b.js)

---

### Strategy 3: Persistent Iframe Reuse + Route Reset (`Warm Runner Architecture`)

#### When to Use:
- Multi-period batch operations on `return.gst.gov.in` where creating new iframes per period triggers WAF bot detection, iframe thrashing, or high latency.
- Modules with multiple filing variants (e.g., GSTR-1 with Monthly, Quarterly IFF, Nil, and Legacy 2021 returns).

#### Technical Workflow:
1. **Filing Variant Detection**:
   - Queries `/returns/auth/api/formdetails` & `/returns/auth/api/rolestatus`.
   - Resolves variant:
     - `V1_NEW`: Monthly filer -> navigate `/auth/gstr1/gstr1sum`, click `genratepdfNew()`.
     - `V1_IFF`: Quarterly filer (months 1 & 2) -> navigate `/auth/gstr1/gstr1sum`, click `genratepdfNew()`.
     - `V2_NIL`: Nil return -> click `generateNILGstr1Pdf()` directly (no navigation required).
     - `V3_OLD`: Pre-April 2022 return -> click `getSummary()` directly.
2. **Iframe Reuse & Route Reset**:
   - Maintains a single `sessionIframe` instance.
   - Resets router state via:
     ```javascript
     $rootScope.$apply(() => { $location.path('/auth/dashboard'); });
     // small delay
     $rootScope.$apply(() => { $location.path('/auth/gstr1'); });
     ```
3. **Strict `shareData` Hydration**:
   - Sets `shareData.IFF = !!variant.isIFF` as a **strict boolean** (prevents `IFF_` filename prefix bug on monthly filers).
   - Sets `shareData.approval_dt = d.apprv_dt` (prevents `.substring()` crashes).
4. **State Rollback**:
   - Backs up 15 `localStorage` keys before execution and restores them in `finally {}` to leave the user's tab clean.

#### Reference Implementation:
- Inject Script: [`content/gstr1-inject.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/content/gstr1-inject.js)
- Background Engine: [`engine/gstr1-native.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/engine/gstr1-native.js)

---

### Strategy 4: Active-Tab Angular Scope Traversal (`Direct Scope Calling`)

#### When to Use:
- The user is already on the return dashboard tab (e.g., `https://return.gst.gov.in/returns/auth/dashboard`), and the portal renders all period action buttons directly on the tab's live Angular scope tree (e.g., GSTR-3B).

#### Technical Workflow:
1. Use `chrome.scripting.executeScript` to target the active tab in `MAIN` world.
2. Hook `window.pdfMake.createPdf` on the active window.
3. Traverse Angular elements to find the dashboard controller scope containing the period action method (e.g., `scope.downloadGSTR3Bpdf(period)`).
4. Call method directly -> capture generated blob -> return to service worker without spawning any iframes.

#### Reference Implementation:
- Background Handler: `handleGstr3bScopePdf` in [`background.js`](file:///D:/ReturnPilot%20V4.0%20mv3%20safe/ReturnPilot-GST-Assistant/background.js)

---

## 3. Declarative Net Request (DNR) Rules Architecture

To allow seamless hidden iframe embedding across GST subdomains (`gstr2b.gst.gov.in`, `gstr1a.gst.gov.in`, `return.gst.gov.in`, `returns2.gst.gov.in`), `rules.json` must strip framing and security headers.

### Required Header Modifications (`rules.json`):
```json
{
  "id": 102,
  "priority": 1,
  "action": {
    "type": "modifyHeaders",
    "responseHeaders": [
      { "header": "x-frame-options", "operation": "remove" },
      { "header": "X-Frame-Options", "operation": "remove" },
      { "header": "content-security-policy", "operation": "remove" },
      { "header": "frame-options", "operation": "remove" }
    ]
  },
  "condition": {
    "urlFilter": "||gstr2b.gst.gov.in^",
    "resourceTypes": ["sub_frame", "main_frame"]
  }
}
```

Whenever adding a new portal subdomain (e.g., `services.gst.gov.in`, `ims.gst.gov.in`, `einvoice.gst.gov.in`), ensure an entry exists in `rules.json` with matching response header removals and `resourceTypes: ["sub_frame", "main_frame"]`.

---

## 4. Binary Stream Interception Standard

Never rely on browser file save dialogs for automated downloads. All downloaders must intercept streams in memory using the triple-hook pattern:

1. **`pdfMake.createPdf` Hook**:
   ```javascript
   const origCreate = window.pdfMake.createPdf;
   window.pdfMake.createPdf = function(docDef) {
       fixPdfDocDefinition(docDef, targetFY);
       const pdfObj = origCreate.apply(this, arguments);
       pdfObj.download = function(filename) {
           pdfObj.getBlob((blob) => resolveCapture(blob, filename, 'pdf'));
       };
       return pdfObj;
   };
   ```
2. **`FileSaver / window.saveAs` Hook**:
   ```javascript
   const origSaveAs = window.saveAs;
   window.saveAs = function(blob, filename) {
       const isPdf = blob?.type?.includes('pdf') || filename?.endsWith('.pdf');
       const isExcel = blob?.type?.includes('spreadsheet') || filename?.endsWith('.xlsx');
       resolveCapture(blob, filename, isPdf ? 'pdf' : (isExcel ? 'excel' : 'other'));
       return true;
   };
   ```
3. **`URL.createObjectURL` & `<a>.click` Neutralization**:
   ```javascript
   // Tracks created Object URLs and prevents <a> click navigation
   HTMLAnchorElement.prototype.click = function() {
       if (interceptAnchorDownload(this)) return;
       return origClick.apply(this, arguments);
   };
   ```

---

## 5. Folder Hierarchy and Download Naming Standard

All downloads dispatched via `chrome.downloads.download` must use the unified folder hierarchy helper:

```javascript
buildFolderDownloadPath(gstin, returnType, period, baseFilename, fy)
// Output Format: <GSTIN>/<FY>/<ReturnType>/<Filename>
// Example: 27AAAAA0000A1Z5/2024-25/GSTR2B/GSTR2B_27AAAAA0000A1Z5_042024_17082026.pdf
```

### Path Formatting Rules:
- **`GSTIN`**: Sanitized alphanumeric uppercase (e.g. `27AAAAA0000A1Z5`).
- **`FY`**: 7-character financial year string (e.g. `2024-25`).
- **`ReturnType`**: Clean identifier directory (e.g. `GSTR1`, `GSTR1A`, `GSTR2B`, `GSTR3B`, `GSTR9`, `IMS`).
- **`Filename`**: Clean, authentic filename with date stamping.

---

## 6. Upgrader Decision Matrix

| Target Return / Module | Subdomain / Environment | Recommended Strategy | Key Mechanism / Hooks | Primary Files |
| :--- | :--- | :--- | :--- | :--- |
| **GSTR-1** | `return.gst.gov.in` | **Strategy 3 (Warm Iframe Reuse)** | 4-variant detector, IFF boolean fix, persistent iframe reuse | `engine/gstr1-native.js`<br>`content/gstr1-inject.js` |
| **GSTR-1A** | `gstr1a.gst.gov.in` | **Strategy 1 (Hash-Route)** | Direct hash routing `#/auth/gstr1a/gstr1sum`, button scope hydration, dual-PDF separation | `engine/gstr1a-pdf-portal.js`<br>`content/gstr1a-inject.js` |
| **GSTR-2B** | `gstr2b.gst.gov.in` | **Strategy 2 (Form POST + Pre-Seeding)** | Hidden form POST, `fixPdfDocDefinition`, separate PDF & 29-sheet Excel streams | `engine/gstr2b.js`<br>`content/2b-inject.js`<br>`content/2b-contentscript.js` |
| **GSTR-3B** | `return.gst.gov.in` | **Strategy 4 (Active Tab Scope)** | Live dashboard Angular scope traversal, `scope.downloadGSTR3Bpdf` | `background.js` (`handleGstr3bScopePdf`) |
| **GSTR-9 / 9C** | `returns2.gst.gov.in` | **Strategy 1 / 3 (Hidden Iframe)** | Formdetails API inspection, table rendering and PDF generation | `engine/return-pdf-portal.js`<br>`content/return-inject.js` |
| **IMS Outward / Inward** | `return.gst.gov.in` | **Strategy 1 (API & Hash)** | Direct JSON/Excel endpoint fetch with `Referer` DNR rules | `popup/popup.js` (`download1ImsExcel`, `downloadImsJson`) |
| **New Module Scaffold** | *Any new subdomain* | **Choose via Decision Flowchart above** | Follow the 6-step pattern checklist below | — |

---

## 7. Step-by-Step Checklist for Implementing a New Module

When building a new module or upgrading an existing one:
1. **Analyze Subdomain & Routing**: Check whether the target page uses hash routing (`#/`), POST parameters, or standard GET requests.
2. **Configure `rules.json`**: Ensure frame header stripping (`X-Frame-Options`, `CSP`) is enabled for the subdomain.
3. **Register in `manifest.json`**:
   - Add content script matching in `content_scripts` (`all_frames: true`).
   - Add inject scripts to `web_accessible_resources`.
4. **Implement Inject Script (`content/<module>-inject.js`)**:
   - Hook `pdfMake` / `saveAs` / `createObjectURL`.
   - Hydrate `$rootScope` and `shareData`.
   - Implement `waitButton` and mode-isolated execution (`runCapture`).
5. **Implement Background Engine (`engine/<module>.js`)**:
   - Manage iframe creation / reuse and postMessage bridging.
   - Enforce sequential tab queuing if necessary.
   - Save files using `buildFolderDownloadPath` and register with `DownloadRegistry`.
6. **Wire Popup UI & Validate**:
   - Ensure individual button triggers in `popup/popup.js` isolate PDF vs. Excel without cross-firing.
   - Verify syntax across all files using `node --experimental-vm-modules scratch/check_syntax.js`.
