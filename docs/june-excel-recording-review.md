# June GSTR-2B Excel recording review

Reviewed upload commit `b94b6ae`; no captured JavaScript was executed and no
credentials were used. All event indices below are zero-based in
`2b download/returnpilot_rea_evidence_gstr2b_gst_gov_in_1792656547280.json`.
Companion files end in `1792656541962.json` (v6.5), `1792656548209.har`, and
`1792656543681.md` (brief). This is evidence review, not live extension testing.

## Observed output

- Event 293 begins DOWNLOAD GSTR-2B DETAILS (EXCEL) recording.
- 295: spreadsheet-MIME Blob, 61,951 bytes, 507 ms after recording start.
- 296/298: saveAs observations of that size/type at 507/508 ms. Their filenames
  contain the June 2026 period token, a GSTIN token, and an .xlsx suffix. Token
  presence is not an independent comparison against an authenticated taxpayer.
- 297: recorder reports duplicateCount=3, source window.saveAs. Overlapping hook
  observations are not evidence of three browser downloads.
- 299: createObjectURL for the same size/type at 508 ms; 300 FILE_GENERATED is an
  inspector milestone, not browser DownloadItem completion or XLSX validation.
- 329: recording finalized after 3,891 ms. generation.excelWorkbook is null,
  libraryCalls is empty, and no workbook bytes/cells were captured. Its two API
  entries are main-es2015.js and main-es5.js source-analysis requests, not the
  financial API responses. normalizedReport.downloads also mixes diagnostic
  records; do not interpret its length as a saved-file count.

This is stronger output-path evidence than the empty safe-recorder report. It
still does not explain why that separate recorder captured no events. Do not
merge the two sessions into a single causal trace.

## Source and API findings

- HAR entries 2/3 and REA events 232/234 identify getuserdtls/getdata but carry
  status 0 and no response bodies. Status 0 here cannot establish an HTTP/server
  rejection. The financial payload and recipient identity remain unverified.
- Source events 310/320 repeat the known Excel path. Four inspected ES5 bodies
  (getExcelData, downloadExcel, addReadmeworksheet, generateExcel) are identical
  to prior REA event 642 from the earlier recording.
- downloadExcel supports getJSONData refresh, firstExcelResp, fc/fcRej and part
  selection. getExcelData consumes retrieveData. Do not label the entire outer
  flow cache-only or assume the refresh/multipart branches ran in this capture.
- Read me identity still comes from retrieveUserDetailsData/retrieveGenDate:
  C4 financial year, C5 transformed period, C6 GSTIN. This is source-derived,
  not an observed workbook. addReadmeworksheet is truncated after 5,000 characters.
- The keyed generateExcel body remains the 713-character filtered B2B ITC-reversal
  exporter. A name collision prevents treating it as the full-details generator.
- Ownership event 344 reports availableInSource=true, availableNow=false,
  liveScopeInstances=[], recommendedInvocation=null for getExcelData,
  downloadExcel and generateExcel. Installed factory hooks do not prove a usable
  live service binding or captured financial arguments.

## Recording quality and privacy

The brief contains only a generation error (`reading 'length'`). Events 249/250
include an undefined `push` exception; its stack includes an extension frame.
That does not establish which code caused it, but it makes this an instrumented,
not clean baseline, session. Earlier events were restored across reload, and the
recording also includes unrelated portal and source-analysis activity.

Both JSON files contain an apparently unredacted 32-character `at` response
header in traceEvents[42].extra.responseHeaders. No value is reproduced here.
The owner was advised to sign out of the session and sanitize before further
sharing. These files also contain taxpayer identifiers and storage-key metadata.
The HAR request-header check found no at/Authorization/Cookie header in its
entries; that is not a comprehensive privacy certification of the bundle.
Do not copy raw evidence into test fixtures or distribute it with a release.
Removing a value in a later commit would not remove it from Git history; history
remediation requires separate authorization and coordination.

## Implementation decision and verification

No production hooks, invocation recipes or financial validation are added from
this evidence alone. Current PDF identity and filename-contradiction guards stay
in place. Remaining work is stable ownership of the actual source payload,
source/workbook identity correlation, multipart completeness, and browser download
acknowledgement—not invocation of an arbitrary function named generateExcel.

Ten targeted evidence assertions passed (counts, output size, missing workbook,
missing API bodies, unavailable live binding and source multipart/truncation
markers). Four source-body equality checks passed. Documentation-only milestone;
no runtime test suite or full build rerun for this review.
