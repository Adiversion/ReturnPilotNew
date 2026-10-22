# Focused authorized GST download diagnostic

Script: [`tools/gst-safe-download-recorder.js`](../tools/gst-safe-download-recorder.js)

## Purpose

Record a small, structured report while you manually download one GST PDF or Excel.
This is a diagnostic tool, not a repair, uploader or filing script. Review it before
running code in a logged-in portal. It adds temporary observers/wrappers; although
it preserves native calls and makes no new network requests, instrumentation can
still affect timing and cannot be guaranteed compatible with every portal release.

## Run a clean recording

1. Use a GST account you are authorized to access. Disable ReturnPilot and other
   GST helper/recorder extensions temporarily so their hooks do not interfere.
2. Log in normally and open the target GSTR-2B summary page or GSTR-3B dashboard.
3. Open Developer Tools → Console. Read/copy the entire supplied JavaScript file,
   paste it into the console and run it. Do not bypass browser security warnings
   for code you have not reviewed and do not understand.
4. Enter the target GSTIN and selected period (`MMYYYY`) in the page prompts.
   These values remain in the page's memory for comparisons and are not exported.
   Never enter a password, OTP, authentication token or cookie.
5. Perform ONE normal download using the portal's PDF or Excel button. Where the
   portal supports period changes within the same page, installing the recorder
   before selecting the target period helps capture initial data requests.
6. Wait until the actual file is saved (or the portal reports an error), then run:

   ```javascript
   RP_SAFE_TRACE.export()
   ```

7. Answer the confirmation about whether the expected file actually saved. That
   answer is explicitly labelled as user-reported, NOT browser-observed completion.
8. A small `returnpilot-safe-trace.json` report downloads. Review its contents and
   attach it in chat. Rename it descriptively without a GSTIN, for example
   `2b-april-pdf.json` or `3b-may-pdf.json`.
9. Reload before the next clean recording and run the script again. Stop without
   export using `RP_SAFE_TRACE.stop()`. Reload also removes installed observers.

Start with three recordings: **2B PDF, 2B Excel, 3B PDF for one period**. Then repeat
for a second period. The existing evidence does not establish a native 3B Excel
button; do not look for or trigger one just for this test.

A full page navigation/reload removes this console recorder. If that happens,
reinstall it on the destination page; it does not follow navigation or persist.
Do not switch accounts while recording financial operations. Cancellation stress
tests will be a separate controlled step after normal baseline recording.

## What is exported

- Allowlisted API endpoint paths, HTTP status, known response field names/types.
- Boolean taxpayer/period matches for request and selected response identity fields.
- Presence of multipart indicators (`fc`, `fcRej`), not their data payloads.
- PDF header identity comparisons, not names, header values, amounts or tables.
- Blob sizes and PDF/Excel classification, not bytes, object URLs or filenames.
- Page-side saveAs/anchor observations, not proof of browser download completion.
- Read me cell identity comparisons when a global ExcelJS workbook can be observed.
- Counts/coverage limits, pending fetch-body reads, capped event count and the
  user's confirmation that the file was saved.

## What is NOT collected/exported

No cookies, storage contents, HTTP headers, passwords, authentication tokens, raw
API response bodies, actual GSTINs/periods, names, invoice records, financial amounts,
file bytes or full URLs. Actual response values are inspected transiently only to
compute allowed field shapes and match booleans; they are not included in reports.
The report itself still contains operational metadata, so review before sharing.
The target GSTIN/period remains in the script closure until page reload/collection.

## Coverage limits

- Requests completed before installation cannot be recovered.
- Top-page hooks do not observe separate frame contexts automatically.
- Webpack-private ExcelJS/services may not be global. `workbookChecks: []` can mean
  unavailable instrumentation, NOT missing GST workbook data.
- The script does not fetch remote portal scripts, evaluate module factories,
  crawl webpack internals, extract service caches or alter loaded data.
- A page console cannot access extension `chrome.downloads` DownloadItem events.
  `browserCompletionObserved` is always false. Native download acknowledgement
  needs a separately scoped extension-side integration.
- This is baseline user-run testing, not automated live testing of the refactor.
- Export only after activity settles; nonzero pending reads/dropped events indicate
  incomplete coverage. Errors/empty output are useful diagnostics, not permission
  to disable checks or automatically repeat downloads.

## Automated verification

`npm run test:safe-recorder` runs six VM tests covering zero requests at install,
restoration, original fetch-promise preservation, endpoint allowlisting, redaction,
PDF non-mutation and workbook comparison-only reporting. These use synthetic data
and do not prove compatibility on the live GST portal.
