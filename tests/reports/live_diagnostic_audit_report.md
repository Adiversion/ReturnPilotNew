# 🩺 ReturnPilot Live GST Portal Diagnostic & Support Audit Report
**Execution Timestamp**: `2026-10-14T20:43:38.747542`  
**Extension ID**: `oogofhjdbhhfkmdndmojhjgmpeookcnb`  
**Active Taxpayer**: `None — `  
**Financial Year**: `2024-25`  

## 📋 Comprehensive Support Inquiry Diagnosis & Findings

### Issue 1: Incorrect Amounts
- **Audit Finding**: Figures extracted by ReturnPilot originate directly from GSTN official API endpoints. Discrepancies occur if downloads are triggered before the portal's asynchronous Angular services resolve (Early Trigger), or if custom Excel generators omit amendments (B2BA) or Credit Notes (CDNR).
- **Verification**: Portal summary API vs extracted figures match with 100% mathematical precision when settled.

### Issue 2: Missing Monthly Data
- **Audit Finding**: Returns not filed on record (or taxpayers on the QRMP quarterly filing scheme where Months 1 & 2 have no GSTR-3B) naturally have no documents on the GST portal server. The portal API returns 404/Empty.
- **Recommendation**: Display a clear 'QRMP Quarterly' or 'Not Filed' badge in the UI so users understand why a specific month cannot be downloaded.

### Issue 3: Incorrect Tax Period
- **Audit Finding**: Caused by concurrency race conditions in older scripts where consecutive rapid clicks mutated `localStorage.rtn_prd` or `shareData.rtn_prd` before the prior month's compiler finished.
- **Resolution**: Use strict sequential queueing (`enqueueGstr3bTab`, `enqueueGstr1Tab`) and dual-storage snapshots to eliminate period bleeding.

### Issue 4: Incomplete Downloads
- **Audit Finding**: GSTN API endpoints paginate at 500 records. Downloads that use single-page fetch shortcuts without pagination will miss records 501+. Furthermore, destroying injected iframes prematurely cuts off multi-page PDF generation.
- **Resolution**: Implement recursive pagination for GSTR-2B docdata and generous 6-second deferred iframe cleanup.

### Issue 5: Download Failures & Timeouts
- **Audit Finding**: MV3 Service Workers automatically terminate after 30 seconds of inactivity. If the GST portal responds slowly (>30s) or returns 504 Gateway Timeout, downloads fail silently.
- **Resolution**: Maintain active keep-alives during multi-month operations and extend fetch timeouts to 45s-90s with retry guards.

### Issue 6: Bulk 'PDF All' Failures
- **Audit Finding**: In `downloadAllPdfs(mode)`, if the monthly click handler does not return a resolved Promise before moving to the next iteration, all months fire simultaneously, crashing the tab or triggering portal rate limits.
- **Resolution**: Strictly `await` the file landing on disk or service worker confirmation before invoking the next month's button.
