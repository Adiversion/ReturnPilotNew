# Download safety refactor — staged rollout

## Status

Phase 1 foundation implemented: `engine/download-coordinator.js` and tests against
that exact module. **Not imported by background.js or connected to live downloads.**
The coordinator foundation alone does not fix production portal races.

Phase 2a implemented in the production GSTR-2B engine:
- Extracted the serialized MAIN-world runner to `engine/gstr2b-frame-runner.js`.
- Parent accepts messages only from its own iframe and the exact GST-2B origin.
- Results require an exact unique request ID; successful results must match
  requested period, GSTIN and format. Missing IDs no longer pass.
- Frame metadata includes operation ID, format and creating-parent origin.
- Inject script only accepts its owning parent's matching start message once.
- Runner clears timers/listeners on settlement and cleans up append failures.
- Ten tests exercise the actual runner and inject script with controlled frames.

Phase 2b implemented in the production inject script:
- PDF/saveAs invocation and object URL creation no longer settle the operation.
- Observe native `.click()` or non-cancelled synthetic click dispatch on an anchor
  whose blob URL was created after arming this job. Require nonempty bytes and
  matching MIME/extension format; reject known HTML/error MIME and conflicts.
- Waiting for native output rejects on timeout (previously timeout could become
  success with a fabricated fallback filename).
- Results carry `NATIVE_ANCHOR_DISPATCHED`; runner rejects legacy success without
  it and engine propagates it. This is observation, not browser completion.
- Button search respects aria-disabled/aria-busy and skips Excel-labelled buttons
  during PDF requests. This is button eligibility, NOT verified data readiness.
- Clear pollers, observers, waiter callbacks and blob references at settlement.
- Remove unused blob-to-data-URL capture helpers and unrelated filename traps.
- Twelve output tests execute the production inject script using delayed output,
  timeouts, wrong formats, empty/HTML blobs, synthetic clicks and button states.

Remaining limitations: anchor activation can still be blocked by the browser;
`.click()` does not expose cancellation, and this code does not verify downloaded
bytes or their period/taxpayer. MIME/extension checks are not file-signature checks.
Frame removal still follows the native dispatch result, not a browser download
acknowledgement. Validate this handoff before connecting the coordinator.
Portal paths using window.open, data URLs, navigation, captured original methods,
or non-anchor downloads now fail closed instead of claiming success. Confirm the
live GST FileSaver/pdfMake paths before release. The native save itself is not
suppressed or replaced. No permissions, DNR rules or licensing changes.

Run `npm run test:gstr2b-frame` and `npm run test:gstr2b-output` as well as coordinator tests. Live portal testing
has not been performed. Test-lab copies are intentionally not migrated; they are
not the production entry point.

Run `npm run test:coordinator`. The master test pipeline also runs these tests.
No dependencies or GST credentials are required for this suite.

## Current production boundary map

- popup/popup.js selects actions and sends return-specific messages.
- background.js dispatches GSTR-1, 1A, 2B PDF/Excel, 3B and 9 native handlers.
- engine/ modules orchestrate MAIN-world scripts and portal context.
- content/ scripts initialize portal state and observe/capture native output.
- Background DownloadRegistry/onDeterminingFilename handle download naming.
- Some engines have independent per-tab queues; these are not one shared lock.
- Generated-file API downloads and local report builders are separate paths.

## Phase 2c — PDF identity containment (implemented)

`content/return-identity.js` validates the original pdfMake document definition's
labelled header tables, based on the uploaded 2B and 3B layouts. Requires the
correct return title, GSTIN, month and FY; derives MMYYYY across April/March FY
boundaries. It does not scan arbitrary amounts/dates for six-digit numbers and
never substitutes requested identity for missing evidence.

- 2B bridge loads the packaged helper before the inject script. The PDF hook
  validates before FY correction or compilation. Mismatch suppresses compilation,
  rejects the operation, and prevents its tracked PDF anchor from bypassing the
  guard. Excel behavior is unchanged by this identity guard.
- 3B engine installs the same helper in MAIN world and validates before invoking
  the native compiler. Fallback stream capture requires a previously validated
  document; an unvalidated fallback fails closed. Initialized cleanup variables
  also fix early-error temporal-dead-zone failures when no scope is available.
- Resource registration changed to expose this packaged helper on existing
  allowed portal origins. No new host permissions or remote code.
- Tests use synthetic taxpayer IDs and minimal recorded header layouts; production
  3B integration tests run its actual serialized function with controlled Chrome
  and Angular mocks, including successive April/May requests with a stale April
  document and an apparently correct May filename.
- One-off offline checks on the four uploaded docDefinitions accepted matching
  identities and rejected cross-month substitution. Raw data is NOT in fixtures.

### Deliberate compatibility limits

Unknown/historical header layouts, missing FY and direct PDF fallback paths without
an observed docDefinition now fail instead of silently filling a requested year.
This is intentional but needs live validation before release. An English labelled
identity table within the first six top-level content blocks is currently required.

This is output identity containment, NOT full source-data validation: matching
headers could still accompany stale/mixed financial tables. It does not fix
shared storage/session concurrency, account switches, late callbacks after timeout,
Excel content identity, or browser completion/teardown. Coordinator remains unwired.
Next work must verify source data and ownership/cancellation rather than claim the
header guard alone solves data contamination.

Run `npm run test:pdf-identity` in addition to coordinator/frame/output tests.

## Coordinator contract

A future singleton in the service worker will serialize portal-mutating adapters
across returns, formats and tabs sharing a GST session. Do not instantiate one
coordinator per engine, tab, or popup; that would recreate the collision problem.

Each job snapshots scalar identity: operation ID, session generation, tab ID,
GSTIN, return type, period and format. Extra input fields are discarded.
Required identity fields must already be resolved before enqueueing. Validation
here ensures presence, not that a taxpayer identity is authoritative.

Adapters implement:

1. `prepare(scope)`: acquire/initialize a context and return its resource handle.
2. `waitUntilReady(scope, resource)`: resolve only after return-specific data and
   period checks. A visible button or arbitrary delay is not sufficient.
3. `execute(scope, resource)`: resolve only after safe file handoff. Invoking a
   portal function alone is not proof. This is NOT browser download completion.
4. `cleanup(scope, resource)`: remove owned listeners/hooks/frames as appropriate
   and quiesce work. Called even after partial prepare failure (resource can be
   undefined); the adapter must retain enough ownership information to clean up.

`scope` includes the frozen job, AbortSignal and `assertCurrent()`. Adapters must
check cancellation before side effects and validate operation ID, source window,
origin and available taxpayer/period metadata when accepting asynchronous results.
The coordinator cannot inspect those portal-specific facts itself.

## Cancellation and failure safety

- Session invalidation aborts all old-generation work; late results are rejected.
- Queued cancellation is cooperative: its completion rejects when it reaches the
  lane, without starting its adapter.
- Running cancellation does not immediately release the lock. Cleanup must finish
  before another job starts. Aborting a promise does not stop portal JavaScript.
- There is deliberately no Promise.race timeout that releases the lane while old
  work can continue. Adapter timeouts must also ensure owned work is quiescent.
- If cleanup fails, this coordinator blocks subsequent execution. Recovery needs
  verified teardown of portal contexts before replacing the instance; merely
  resetting a boolean or reloading the worker is not a safe recovery procedure.
- Observer failures do not affect scheduling. State events include taxpayer
  identity: keep diagnostics local, redact exported logs, and never add tokens.
- HANDOFF_CONFIRMED means the adapter handoff and cleanup succeeded. It must never
  be rendered as a completed browser download without download-event evidence.

## End-of-flow review: consult before the next implementation

[portal-evidence-followup.md](portal-evidence-followup.md) adds evidence overlooked
in the initial ES2015 excerpts. ES5 source exposes Read me C4–C9 identities and
Excel refresh/multipart branches; getgenpdf responses contain r3b.gstin and
r3b.ret_period. Do not assume Excel is cache-only or bind the wrong generateExcel
function by name. 2B PDF headers come from userdetails while figures come from a
separate payload, so header validation cannot establish financial consistency.
Recorder-completed flags do not prove a browser download completed.
No runtime changes were made for this evidence-review milestone.

## Uploaded portal evidence review

Read [portal-recording-analysis.md](portal-recording-analysis.md) before adding
readiness checks. Source snippets confirm 2B uses `retrieveData()` for both PDF
and Excel, whereas 3B's `downloadGSTR3Bpdf()` fetches data. The 2B response bodies
are absent from the uploads; generated summary instructions are partly incorrect.
The observed output chain supports waiting beyond invocation, but does not prove
our native-anchor hook or safe frame teardown. A clean browser recording and
sanitized response schemas are still needed. This evidence review changed docs
only, not production behavior.

## Before connecting the first production adapter

Use GSTR-2B PDF/Excel as the first candidate because both mutate the same portal
integration. Do not route callbacks through the coordinator without refactoring
context ownership/readiness: legacy success callbacks have different meanings.

- [ ] Resolve and verify taxpayer/tab identity at submission.
- [x] Add per-operation message IDs and verify event.source and event.origin.
- [ ] Implement data readiness checks for requested period, including nil returns.
- [ ] Define safe native-download handoff and register naming metadata beforehand.
- [ ] Ensure cleanup does not destroy an in-progress native download.
- [ ] Connect all relevant account-switch/logout paths to session invalidation.
- [ ] Address service-worker termination: in-memory locks are not durable, and old
      portal frames may survive. Detect/reconcile existing contexts on startup;
      never blindly replay file-generation/download jobs.
- [ ] Account for existing caller timeouts: queued work can outlive a popup timeout.
      Use job IDs with progress/status retrieval and explicit cancellation rather
      than relying solely on one long-lived response callback.
- [ ] Route competing legacy engines through the same ownership boundary before
      claiming cross-engine serialization is enforced in production.
- [ ] Verify behavior on the live portal with an authorized session.

## Subsequent phases

1. Migrate portal adapters one at a time with readiness/cancellation tests.
2. Correlate browser download started/completed/interrupted events with job IDs.
3. Extract session, API, polling and UI services from oversized controllers.
4. Deduplicate test-lab copies where feasible; exercise production modules.
5. Relax concurrency or enable frame reuse only after isolation tests and live
   portal evidence establish safety. Keep API-read scheduling separate.

## Verification limits

Unit tests cover scheduling, immutable identity, readiness gating, stale-result
rejection, cancellation, cleanup and lifecycle reporting using controlled adapters.
They do not prove GST readiness selectors, actual file contents, browser-download
completion, browser lifecycle recovery, or cross-frame storage isolation.


## User-run evidence collection tool

`tools/gst-safe-download-recorder.js` and `docs/safe-recorder-guide.md` provide an
optional diagnostic for the owner to run on an authorized portal. It observes
allowlisted existing requests and output events, exporting field types and match
booleans rather than sensitive values. No response schemas or runtime service
access are fabricated. Webpack-private workbook visibility remains a limitation;
page-side observations are not browser download acknowledgement. Six VM privacy/
behavior tests pass, bringing focused tests to 62; no new live GST claim is made.
This tool is excluded from production packaging (tools/ is not an active directory).

### Recorder v2 / user evidence follow-up

User-run v1 2B PDF/Excel output matched filename identities, but June Excel yielded
no events despite user-reported saving after installation. Treat as an unresolved
coverage gap. See portal-evidence-followup.md for the sanitized evidence summary.
V2 adds capture-phase anchor observations, bounded metadata correlation, hook
ownership/frame reporting and data.bal identity comparison. No production runtime
changes or financial validation claims. Eleven recorder tests / 67 focused tests
pass; v2 live execution is still unverified. Next production work remains source
correlation/Excel guards, scheduling/session cancellation and browser acknowledgement.
