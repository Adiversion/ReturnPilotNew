# Recorded GSTR-2B / GSTR-3B behavior — 2026-10-22

## Scope and provenance

Reviewed the ten files uploaded in commits `e45e6fe` and `7c349ce` under
`2b download/` and `3B Download/`, comparing raw traces, captured function bodies,
HAR entries and normalized flows with the current production engines.
This is offline evidence analysis, not a live validation of the current extension.
No captured portal code was executed. No taxpayer identifiers, amounts or tokens
are reproduced here. Raw recordings are sensitive and should not become test
fixtures; future fixtures should be synthetic/redacted minimal schemas.

Primary source references (array indices below are zero-based):
- 2B records: `2b download/returnpilot_v6_5_records_gstr2b_gst_gov_in_1792650418883.json`
- 3B records: `3B Download/returnpilot_v6_5_records_return_gst_gov_in_1792650056695.json`
- Corresponding HAR and REA exports in those directories.

## Evidence quality — do not treat generated instructions as authoritative

- Both `returnpilot_ai_brief_*` files contain a generation error, not a brief.
- The 2B architecture document's generic causal table incorrectly names AngularJS,
  `downloadPrePdf`, and a 3B controller while describing an Excel output. The raw
  2B trace instead identifies Angular 8.2.14 and a webpack-based application.
- The 3B generated document says no docDefinitions were captured, but its records
  contain two `normalizedReport.capturedDocDefs` and corresponding PDF events.
- Several source bodies are truncated. Complete smaller entry methods are useful;
  truncated compiler bodies must not be treated as complete implementations.
- The recorder fetches many scripts for its own source analysis. Those requests
  are not all prerequisites of a user's download. Do not replay its endpoint list.
- The 2B trace spans navigation through the return dashboard and the 2B app. Other
  injected extensions and recorder errors are visible (for example events 178–197).
  It is not a clean, uninstrumented measurement of the portal alone.
- Duplicate hook messages do not establish duplicate files on disk. The 2B report
  labels saveAs duplicates while normalized Excel flows record one download each.
- 2B HAR API entries show status 0 and no body, while normalized API summaries
  list 200 with no parsed/body data. Actual response payload readiness remains
  unproven. Zero here is not an HTTP server status we should replay or interpret
  as proof of server failure.

## GSTR-2B: data is cached before the download methods use it

Recorded outputs: PDF and Excel for April and July 2026.

Observed bootstrap endpoints include:
- `/gstr2b/auth/api/gstr2b/getuserdtls?rtnprd=<period>&fy=<fy>`
- `/gstr2b/auth/api/gstr2b/getdata?rtnprd=<period>`

The captured `main-es2015.js` function-body event at trace index 218 contains
these complete entry methods (also captured again later):

```javascript
getPdfData = function(l, n) {
  this.iffLive = null != l && l;
  this.imsGoLive = null != n && n;
  this.generatePdf(JSON.parse(this.gstr2bservice.retrieveData()));
};
getExcelData = function(l, n) {
  this.iffLive = null != l && l;
  this.imsGoLive = null != n && n;
  this.generateExcel(JSON.parse(this.gstr2bService.retrieveData()));
};
```

Consequences:
- A visible/enabled button is not proof that retrieveData contains the right data.
- Editing storage labels or setting the requested GSTIN in a message does not
  prove the service's cached payload has been loaded/replaced.
- Calling an AngularJS `$scope` method is not the appropriate generic 2B strategy.
- Do not hardcode minified class names or webpack module IDs as stable interfaces.
- The recorded July Excel waterfall reports zero API calls after the click, which
  is consistent with cached-data compilation, not evidence of a failed request.

### PDF sequence

Trace indices 224–255 (April) and 581–603 (July) show:

```
PDF button → portal getPdfData/generatePdf/getPDF path
→ pdfMake.createPdf → pdf.download → getBlob
→ PDF Blob → saveAs → createObjectURL → subsequent DOM click event
```

The exact linkage of the last generic DOM click to its anchor/default browser
behavior is not established by these events; browser-download acknowledgement is
still required before calling it a reliable handoff.

Recorded PDF compilation durations are approximately 2.17–2.66 seconds, versus
roughly 12–14 ms to the download-method invocation. These are instrumented sample
observations, not timing thresholds or performance guarantees.

### Excel sequence

Trace indices 278–290 and 650–663 show the Excel button followed by workbook Blob,
module-level/window saveAs observations, object URL creation and a later DOM click.
ExcelJS and FileSaver are discovered; XLSX blobs are roughly 63 KB in these samples.
A zero-byte ZIP Blob also appears during initialization and is not a valid output.

### Relation to the current extension

- `engine/gstr2b.js`: propagates cookies and creates a fresh portal frame through
  `engine/gstr2b-frame-runner.js`.
- `content/2b-contentscript.js`: seeds storage and injects the MAIN-world script.
- `content/2b-inject.js`: selects the portal's PDF or Excel button, letting portal
  code build the document. Current hooks also adjust FY metadata/doc definitions;
  this is not a guarantee of byte-identical manual output.
- Phase 2b correctly stopped treating pdf.download invocation/object URL creation
  as immediate success. However, the uploaded recording does not prove our exact
  anchor interception path works in a clean browser, or that immediate frame
  removal after that event is safe.
- Missing requirement: validate cached service data or correlated successful
  response contents against requested taxpayer/period before triggering output.
  These exports lack the 2B response bodies and discovered live component handles
  needed to implement that condition confidently without guessing.

## GSTR-3B: dashboard entry method loads the return before compilation

Recorded outputs: PDFs for April and May 2026. The captured normalized flows begin
with a button carrying `data-ng-click="downloadGSTR3Bpdf()"`.
The complete captured dashboard entry method is in trace index 80 (3B records).

```
downloadGSTR3Bpdf()
→ formdetails for the requested period
→ branch based on portal period rules
→ sysint and getgenpdf (asynchronous requests, not a universal serial chain)
→ assign getgenpdf.data.r3b + taxpayer/filing metadata to shareData
→ downloadPdf('FIL')
→ taxpayble request observed
→ createGstPdf → pdfMake → PDF Blob → saveAs → object URL
```

The method also contains a legacy summary-endpoint branch. Do not assume one
sample's endpoint sequence is valid for every historical period.

Important findings:
- The method reads `shareData.rtn_prd`; it does NOT take a period argument.
  Calling `downloadGSTR3Bpdf(period)` alone cannot select a month.
- It reads `shareData.gstr3bSummary.gstin` for sysint. The April capture includes
  `gstin=undefined` on that request. HTTP 200 responses for sysint contain business
  status 0 and an error. A PDF still followed. Therefore HTTP 200 alone and
  "all endpoints must succeed" are both inadequate readiness policies.
- `getgenpdf` returns JSON (r3b plus filing/taxpayer metadata), not a ready PDF.
- The captures show portrait A4 PDFs with a FILED watermark. Sample PDF compilation
  durations are about 0.46–0.51 seconds; again, not values to turn into sleep calls.

### Relation to the current extension

`engine/gstr3b.js` finds the live dashboard AngularJS scope, sets period/GSTIN state
including shareData, clears selected caches, then calls downloadGSTR3Bpdf. The
portal still performs its own API and document-compilation logic.

The extension deliberately differs at delivery: it intercepts the PDF download
method, captures base64/buffer output, suppresses that native download to avoid
an extra file, and uses `chrome.downloads.download` itself. This is unlike 2B's
current native-anchor observation strategy. Storage restoration and queues need
to cover all asynchronous mutations, not merely invocation of the entry method.

### GSTR-3B Excel is not established by these recordings

The 3B folder's two normalized user flows are PDF downloads. Loading exceljs.js in
the dashboard is not proof of a native 3B Excel export. Current `download3bExcel()`
in popup/popup.js fetches API data (and optional 1/2B comparative data) and builds a
ReturnPilot workbook via `core/consolidated-gstr3b-builder.js`. Do not label that
workbook as the same portal-native Excel workflow recorded for GSTR-2B.

## Implications for the next refactor

1. Keep separate 2B and 3B adapters; standardize job identity and lifecycle, not
   portal implementation. Preserve portal-generated document logic.
2. For 2B, obtain sanitized successful getuserdtls/getdata response shapes and
   verify how retrieveData is populated for each period. Never manufacture a
   readiness condition from seeded localStorage alone.
3. For 3B, retain the outer downloadGSTR3Bpdf entry method; directly invoking
   downloadPdf('FIL') would skip its data-loading stage.
4. Treat sysint errors according to portal branch semantics. Required financial
   data errors must not silently become zeroes; optional data needs explicit policy.
5. Collect actual browser download created/completed/interrupted events correlated
   to the operation before allowing frame teardown or reporting completion.
6. Add delayed-cache and stale-cache synthetic fixtures once the 2B schema is
   known; do not check raw uploads containing taxpayer data into automated tests.
7. Repeat a clean recording with unrelated extensions disabled. The existing
   uploads help choose architecture but are not release validation.

## Privacy follow-up

The 3B HAR contains an unredacted `at` authentication header value. Recordings also
contain taxpayer/document data. No token value is printed here or used for any
request. Sign out of the recorded GST session, sanitize all exported copies, and
consider repository visibility/history exposure. A normal deletion commit alone
does not erase previously committed sensitive data. History cleanup requires a
separate owner-approved procedure; no history rewrite was performed in this review.
