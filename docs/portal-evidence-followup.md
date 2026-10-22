# End-of-flow evidence review: remaining safety requirements

Reviewed 2026-10-22. Supplements and qualifies `portal-recording-analysis.md`.
This milestone is documentation/evidence analysis only; no runtime behavior changed.

## Sources and inspection scope

Re-examined both records exports and the later REA exports, including nested
functionBodies, ownershipMap, source snippets, normalized flows, scope snapshots,
and final events. No captured source was executed, no credentials used, and no
raw taxpayer values are reproduced below.

Stable source references for the new findings:

- `2b download/returnpilot_rea_evidence_gstr2b_gst_gov_in_1792650423956.json`
  - `traceEvents[240].extra.functionBodies` (main-es5.js, 49 captured bodies)
  - `traceEvents[642].extra.functionBodies` (later repeated main-es5.js capture)
  - `traceEvents[684].extra.ownershipMap` (late ownership inventory)
  - `traceEvents[671].extra.waterfall` (last recorded Excel waterfall)
- `3B Download/returnpilot_rea_evidence_return_gst_gov_in_1792650063919.json`
  - `traceEvents[218].extra.responseParsed` and `[291]` (getgenpdf responses)
  - `traceEvents[231].extra.responseParsed` and `[312]` (taxpayble responses)
  - `[325]` last Download waterfall completion; `[326..345]` subsequent inspector
    export/UI, ownership and scanner events, not a browser download acknowledgement.

Indices are zero-based and apply to the filenames above. Different exports have
slightly different event counts; use named actor/action fields to confirm context.

## 1. Source-data readiness and identity

### GSTR-3B: enough evidence for concrete primary-response checks

The two actual getgenpdf responses have:

```
status
 data
   r3b
     gstin
     ret_period
     sup_details
     inter_sup
     itc_elg
     intr_ltfee
     tt_val
     qn
   trdnm / lglnm / arn / arnDt / authSig / desig
```

A future adapter can require a successful business response and verify
`data.r3b.gstin` and `data.r3b.ret_period` against the immutable job before using
that response. This is stronger evidence than a filename or requested state.
It must correlate the actual response used by the portal compiler: a separate
verification fetch does not establish that the portal consumed that same data.

The taxpayble response instead contains `bal`, `status`, `returnsDbCdredList`.
Do not invent taxpayer/period fields on it. Associate it with its request period,
session generation and operation; investigate required/optional branch behavior.
The previously observed sysint business failure remains a separate optionality
question, not an instruction to accept every failed financial-data request.

### GSTR-2B: the source explains a specific mixed-data risk

The captured `generatePdf` body is truncated overall, but its beginning clearly
contains both:

```javascript
this.parameters_ftl = JSON.parse(localStorage.getItem('userdetails'));
// Header and filename use parameters_ftl.fy / rtnprd / gstin.
// Financial tables read the independent function argument:
var summary = l.itcsumm.itcavl;
```

Thus a correct metadata header can coexist with an unrelated cached financial
payload. The existing labelled-PDF-header guard is useful containment but must
not be described as full financial-data validation.

The small captured getPdfData method reads JSON from retrieveData. For readiness,
we need to correlate the metadata, requested period and the financial cache used
in compilation, not merely update localStorage or perform an independent fetch.
The dumps still do not provide populated getdata/getuserdtls response bodies or
a discovered live 2B service instance. The late ownership map explicitly reports
`availableInSource: true`, `availableNow: false`, empty `liveScopeInstances` and
null `recommendedInvocation` for relevant source functions.

## 2. Excel identity/content validation

### Newly located source-derived identity layout

The beginning of captured `addReadmeworksheet` is sufficient to derive the
identity-cell mapping even though the rest of that function is truncated:

```javascript
var user = this.gstr2bService.retrieveUserDetailsData();
var generated = this.gstr2bService.retrieveGenDate();
var values = [user.fy, transform(user.rtnprd), user.gstin,
              user.lgnm, user.trdnm, generated];
var sheet = workbook.addWorksheet('Read me');
// For each index A:
// labels go to row 4 + A, column 1; values go to row 4 + A, column 3.
```

| Read me cell | Source value |
| --- | --- |
| C4 | Financial year |
| C5 | Transformed return period |
| C6 | Taxpayer GSTIN |
| C7 | Legal name |
| C8 | Trade name |
| C9 | Generation date |

This provides a concrete candidate for workbook identity validation. It is derived
from captured source, not verified against a parsed actual XLSX file in the upload.
The runtime text format returned by transform(rtnprd), header labels, workbook
variants and multipart exports need confirmation. Avoid assuming every detail
export has a Read me sheet.

The B2B worksheet builder also exposes row mapping: supplier ctin, invoice number,
invoice date, taxable value and tax components, supplier period, filing date, ITC
availability and further fields. It writes one row per item. These are useful for
source-to-workbook reconciliation fixtures, but not evidence that runtime values
were captured. Supplier GSTINs must NOT all equal the recipient taxpayer, and
invoice dates/supplier periods need NOT all equal the selected statement period.

### Correction: Excel is not universally a cache-only workflow

The captured `downloadExcel(l)` source includes:

- A first-part path using `firstExcelResp.data`.
- A `service.getJSONData(this.rtnPrd, l - 1).subscribe(...)` path.
- Error handling via `status_cd`.
- Single-response handling that calls setgenDate, setData(JSON.stringify(e.data)),
  then getExcelData.
- Multipart counts through `fc` and/or `fcRej`, a part-selector array and cached
  first response.

This proves such paths exist in captured source, not that every one ran during the
two observed button clicks. A recorded click waterfall with no API call cannot
establish that all Excel downloads are cache-only.

Also, the map's `generateExcel` body is a filtered B2B ITC reversal exporter
(`filteredDocObj`, a `B2B_ITC Reversal_...` filename). It is NOT safe to assume this
is the full-details generateExcel called by getExcelData merely because the names
match. The source scanner indexes function names without a resolved live owner.
We must resolve the relevant component/service rather than bind by name alone.

### Integration implications

- Validate workbook identity before browser dispatch, preferably against a known
  workbook instance or the actual XLSX bytes. Current production 2B code's XLSX
  helper hooks are not evidence of access to the portal's webpack ExcelJS workbook.
- Correlate metadata and financial payload, not just metadata and filename.
- For multipart output, track required parts explicitly; one native download event
  does not prove the complete selected export has finished.
- Actual XLSX binaries/workbook snapshots are not included among the ten uploaded
  Markdown/JSON/HAR files. `generation.excelWorkbook` is null in the normalized
  Excel flows. An installed ExcelJS hook is not a captured workbook-content snapshot.

## 3. Shared scheduling and account-switch cancellation

The recordings help identify what must be protected: portal storage, cached
services, shareData, asynchronous API chains and native output. The evidence does
not show a controlled overlapping PDF/Excel test, account switch during download,
or a tested cancellation/cleanup path.

End-of-recording Cross-Page Session/handOffState fields are inspector navigation
bookkeeping. They are not an extension-wide scheduler or a safe account-switch
protocol. A sequence of two successful monthly downloads does not establish safety
under concurrent execution.

Continue with the planned shared coordinator and immutable session generations,
but validate adapter cleanup and worker restart recovery before wiring it live.
This requirement is primarily our extension design work, not something the portal
recorder can supply as an already-working implementation.

## 4. Live testing and browser acknowledgement

The final useful output chain includes PDF/Excel generation, Blob construction,
saveAs, object URL and later generic DOM-click observations. The late waterfall
`status: completed`, `FILE_GENERATED` and `Recording Complete` labels are inspector
milestones. They do not establish a Chrome DownloadItem's completed state.

No captured browser download ID/onCreated/onChanged acknowledgement was found in
these exported event records. End-of-file events are mostly export buttons and
additional method/ownership/button scans. Therefore they cannot validate immediate
iframe teardown or successful final disk delivery in our modified extension.

Needed integration: correlate download creation to the job, then distinguish
complete/interrupted/missing acknowledgement. Do not rename inspector completion
into browser completion or use a timeout as proof of success.

## Revised evidence matrix

| Requirement | Available evidence | What remains |
| --- | --- | --- |
| 3B source identity | Actual r3b.gstin and r3b.ret_period responses for two periods | Guard the response actually consumed; correlate other requests and cancellation |
| 2B source identity | Cache consumers, separate metadata source, Excel refresh/part branches | Correlated payload snapshot/response schema and safe service binding |
| 2B Excel identity | Source-derived Read me C4–C9 mapping and worksheet row builders | Verify actual workbook/part variants and integrate pre-dispatch validation |
| Scheduling/cancellation | State dependencies and sequential example flows | Implement and test overlap/account-switch behavior |
| Browser completion | Page-side generation/output events | Chrome download acknowledgement and clean live extension regression test |

The owner's suggestion was useful: the later ES5 function-body capture contains
more than the initial ES2015 excerpts. Future agents should consult both bundles
and distinguish source availability from observed runtime ownership/values.
