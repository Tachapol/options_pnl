# Options Journal architecture

## Runtime and boundaries

- **Web.** Next.js App Router, strict TypeScript, Tailwind, server actions for signed-in mutations, Supabase SSR sessions. Start with CSS primitives. Add shadcn components and Recharts when review forms and performance charts need them.
- **Data.** PostgreSQL migrations and the Supabase user-scoped API enforce the initial authorization boundary. Use database functions for atomic ledger transitions and a typed repository for worker operations. Adopt Drizzle for worker-side typed SQL where it simplifies those transactions. It does not replace RLS.
- **Files and jobs.** Keep originals in a private Supabase bucket. Restrict objects by owner and validated account path. Use Inngest for extraction and report retries. Publish durable work from an outbox recorded in the same transaction as the state change.
- **AI.** Use a server-side vision provider with structured outputs and strict Zod validation. A separate coaching call consumes computed metrics and evidence references. Keep provider keys on the server and avoid sending account identifiers or unrelated records.
- **Security.** Derive user identity from verified claims. Use user-scoped database requests on web routes. Authorize each worker job using its authoritative persisted account and job IDs. Rate-limit ingestion, validate file signatures and size, and rotate short-lived signed source URLs. Keep AI output and attachments untrusted.

## Entities and relationships

| Entity | Key fields and relationships | Phase |
| --- | --- | --- |
| auth.users / journal preferences | Supabase identity owns accounts; optional per-user theme | 1 / later |
| trading_accounts | User FK, broker, settlement currency, IANA reporting timezone, session cutoff, FIFO method | 1 |
| audit_logs | Account FK, actor FK, event type, structured changes, timestamp | 1 |
| import_batches | Account FK, source format, ingest state, idempotency key and reconciliation state | 2 |
| source_files | Account and batch FK, private object path, SHA-256, original metadata | 2 |
| trade_summary_records | Account and source FK, source lineage, raw row, normalized paired trade evidence and matching status | 2 |
| option_contracts | Account FK, canonical identity, symbol, option type, strike, expiration, explicit multiplier and deliverable/identifier when known | 2 |
| import_candidates / field_evidence | Account and source FK, raw extraction, normalized fields, row or region, extraction output version, review decision | 2–3 |
| transactions | Account and contract FK when applicable; append-only verified fills, cancellations, fee and lifecycle events, supersession links and broker IDs | 2 |
| transaction_fees | Account FK, source event, linked fill when known, currency and exact amount | 2 |
| trade_lots / lot_allocations | Account and contract FK, opening event, closing event, quantities and allocated basis/proceeds/fees | 2 |
| trades / trade_plans | Account FK, logical grouping and realization status, optional documented setup and risk plan | 2 / later |
| ai_insights / outbox | Account FK, session key, data version, model and prompt version, evidence IDs, report payload and durable job state | 4 |

Use account-scoped composite foreign keys between ledger entities, stable uniqueness constraints for verified broker fill IDs, and indexed candidate fingerprints for secondary matching. Account children use RLS via account ownership. Keep source-to-ledger evidence links many-to-many so matching a duplicate can preserve the second source. Keep real broker order IDs separate from fill IDs. Use append-only ledger postings and reversals; derived positions and metrics can be rebuilt.

## Import and reconciliation

1. Receive an authenticated account-scoped request. Verify file bounds, type and signature, and hash exact bytes. Store the original with its metadata and create a batch. A retry that sees the same file can recover its existing state.
2. Identify CSV format from headers. A broker fill export and a paired trade-summary CSV enter separate adapters. Screenshots go through a vision job with an instruction to extract visible evidence only. Validate nullable values and bounding boxes, and keep provider/model/extraction version with each result.
3. Normalize quantities, units, contract identity and event time. Capture timestamp precision and the source timezone separately from the reporting timezone. Leave ambiguous dates, zones, multiplier or fees unresolved.
4. Verify proven duplicates via broker fill identity or exact source replay. Candidate fingerprints route ambiguous matches to review. Review opens the original alongside uncertain fields. Confirm, edit, reject, link evidence to a duplicate or retry extraction. Undo uses a reversal and respects evidence shared with other batches.
5. Reconcile available positions and explicit fees. Report unmatched sells, open buys, unresolved fees and lifecycle issues. Posting decisions and audit events are atomic. Use an account lock during posting/recalculation to avoid concurrent allocation races.
6. Recompute affected contracts and sessions, publish a versioned report job, and refresh projections. Distinguish verified rows from complete account history.

### Initial migration dataset

The supplied SPY CSV covers October 19 through November 20, 2026. Its fields pair buy and sell details with cost, proceeds, gross P&L, timing fields, and source provenance. It has both original CSV and screenshot-reconstructed lineage. Treat source trade IDs as dataset-scoped and keep the original bytes private. Exact fee and source timestamp context require independent evidence.

Verify each summary's arithmetic against proceeds minus cost. Preserve source labels, row references and any user corrections. Treat its trusted paired rows as distinct historical summaries and reconcile overlap against later broker fills before populating shared metrics. Never synthesize executable broker fills from the summary. Net metrics are incomplete wherever applicable fees are unresolved.

## Financial rules

- Store exact monetary amounts in PostgreSQL `numeric` and serialize as decimal strings. Use integer units at a documented per-currency ledger precision during allocation. Keep premium precision independent. Only chart rendering may convert calculated totals to floating point.
- Rebuild FIFO by account, currency and exact contract. Match sells to the oldest verified open lots. Use trustworthy broker sequence for timestamp ties, otherwise route ties that can change allocation to review. Handle partial exits and carry unallocated basis and fees forward. Assign rounding residuals deterministically at final consumption so all money reconciles to source amounts.
- Use explicit transaction totals ahead of rounded premium-derived amounts. Verify that a source total represents a gross debit or credit before subtracting fees. Keep unallocated fees visible. Reject unsupported short, exercise, assignment or corporate-action math from realized metrics until modeled.
- Record gross = proceeds minus allocated opening cost, net = gross minus applicable fees, and expiration as a zero-proceeds close only with verified lifecycle evidence. Deposits, withdrawals and cancellations do not enter P&L. Keep open risk distinct from realized results.
- Attribute realization to closing event time and configured session boundary, using IANA conversion and explicit DST ambiguity handling. Use one base currency per view until an FX ledger exists. Define breakevens, zero-loss profit factor, and peak-to-trough realized drawdown in metric tests.

## UI sitemap

| Route | Major components |
| --- | --- |
| /sign-in | Email/password, validation and configuration state |
| / | Overview, realized metrics, date controls, performance charts, recent activity and latest verified session review |
| /settings | Brokerage accounts, currency, reporting timezone and cutoff |
| /imports | Multi-file uploader, import history, progress, retry and reconciliation |
| /imports/[id] | Source evidence viewer, uncertain field edits, duplicate comparison and audit trail |
| /trades | Filterable trade ledger and status |
| /trades/[id] | Contract, events, FIFO allocations, fee breakdown and optional trade plan |
| /reviews/[session] | Computed session results, AI observations, references and review checklist |

## Implementation milestones

1. **Foundation.** Bootstrap the app, wire sign-in and sign-out, build a protected shell and account setup, add SQL and two-user RLS tests. Verify with a live Supabase user when the project configuration is available.
2. **Ledger and CSV.** Add source retention and the two CSV adapters. Validate the supplied dataset privately. Implement verified postings, exact FIFO and fee allocation, reconciliation, trade history and the derived dashboard. Test allocations, dates, retries, duplicates and summary overlaps.
3. **Screenshot import.** Connect secure storage and job execution. Add structured extraction, per-field evidence and review decisions, retry, deduplication, and reversible posting. Test anonymized Dime fixtures, overlap and ambiguity.
4. **Daily review.** Generate code-owned metrics and pass a versioned evidence package to the model. Compare sessions and persist structured, referenced commentary. Reuse a matching report by account, session, ledger version, metric version and model/prompt versions. Flag insufficient evidence for behavioral conclusions.
5. **Hardening.** Run full import-to-dashboard E2E and tenant-isolation tests against real infrastructure. Add export and deletion, monitor jobs and allocations, verify performance with realistic data, and configure deployment.

## Technical risks

| Risk | Mitigation |
| --- | --- |
| Summary rows and broker fills overlap | Separate evidence types, reconcile before rolling up, preserve lineage |
| Legitimate fills have identical fingerprints | Require verified identity or human review before merging |
| Crops or rounded premiums obscure source values | Preserve evidence, prefer verified totals, allow unresolved amounts |
| Missing fees or incomplete history overstate certainty | Surface coverage and suppress or qualify net figures |
| Concurrent posting or retries double-count | Durable job keys, transactional posting and account-scoped locking |
| Time assumptions change dates or FIFO order | Preserve source precision, validate zones, test DST and session cutoffs |
| Image prompt injection or AI speculation | Treat images and text as evidence, use strict validation, require evidence references |
| Cross-user disclosure | User-scoped sessions, RLS, private storage, composite FKs and tenant-boundary tests |
