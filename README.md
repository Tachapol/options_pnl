# Options Journal

Phase 1 provides a private, authenticated journal and persistent brokerage account setup. The [architecture and roadmap](ARCHITECTURE.md) define the import, accounting, and review milestones.

## Run locally

Requires Node.js 22 and a Supabase project or a running local Supabase stack.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local` and set the project URL and publishable key. The app uses the signed-in user's token and PostgreSQL policies for access to data. Keep service-role keys out of this application.
3. Apply `supabase/migrations/202611200001_foundation.sql` to the project through your normal migration tooling or the Supabase SQL editor.
4. Create a confirmed email/password user in Supabase Authentication. This foundation uses administrator-provisioned users for personal use.
5. Run `npm run dev` and open http://localhost:3000. Sign in, add an account, revisit Overview and Settings, and sign out.

The account form starts with Dime, USD, and Asia/Bangkok. Change these values to match your account and reporting needs. The account currently uses FIFO and a midnight local session boundary.

## Verify

- `npm run typecheck`
- `npm test` applies the migration in PGlite and tests two-user isolation, anonymous access, forged ownership, audit access, duplicate account names, and invalid timezones. The test substitutes the Supabase Auth role and claim contract.
- `npm run build` builds the production app.

For a live environment smoke test with two confirmed test users, create an account as the first user, sign out, then verify that the second user's Overview and Accounts show only their own records. Confirm a signed-out visit to either protected route redirects to sign-in.

Financial review features in later phases are for reviewing historical trading records. They do not provide investment advice.

## Import trade summaries

1. Apply the remaining migrations in order after the foundation migration. The Dashboard uses `202611200004_journal_calendar.sql`, which depends on the summary and Dime migrations.
2. Restart the development server, sign in, and add or select a Dime account with USD as settlement currency.
3. Open **Imports**, choose the original paired-trade CSV, and select **Import trades**. Open **Overview** to see the resulting source-date history, gross P&L, and gross win rate.

This importer handles the journal's paired-trade summary CSV format and preserves source labels, reported clock strings, and original UTF-8 CSV text. Fees remain unknown. Re-uploading identical files is idempotent. A different file containing the same account, source day, and contract as an earlier import is held at the import boundary by rejecting the entire transaction for review. Distinct source rows in the same file remain distinct. Broker fills and screenshot extraction require separate adapters.

`JOURNAL_TEST_CSV=/absolute/private/path.csv npm test` also validates a private dataset through the parser and test database migration. Use Node.js 22.18 or newer.

## Import Dime screenshots

1. Apply the migrations in order through `202611200005_dime_auto_import.sql` in your Supabase project.
2. In the server's `.env.local`, set the Vision gateway options. Restart the server after changing them.

   ```dotenv
   DIME_VISION_URL=https://api.experientiallabs.ai/v1/chat/completions
   DIME_VISION_MODEL=gpt-4.1-mini
   DIME_VISION_API_KEY=<server-only gateway key>
   ```

3. Run `npm run dev -- --hostname 0.0.0.0`. On a phone connected to the same Wi-Fi, open `http://<computer-LAN-IP>:3000`, sign in, and select **Import Center**. Use a Dime account in USD.
4. Under **Dime screenshots**, choose one or several PNG, JPEG or WebP files up to 8 MB each. Each image has a preview and upload status. Use **Retry image** on the failed image. If you leave the page, select the same failed image again.
5. New, complete fills are imported immediately. Re-uploaded images reuse saved extraction results, and confirmed broker fill IDs are skipped when their details agree. Use **Open review** for incomplete rows, uncertain overlaps, or partial executions without a fill ID. Check date and time against the source, compare with **Trade History**, and confirm the reviewed items.

Byte-identical images and verified broker fill IDs are deduplicated within the brokerage account. Paired CSV summaries have journal IDs and remain separate from broker IDs. Because CSV summaries can contain blended fills and midnight rollovers, a screenshot on the same contract within one day of the source date requires a decision. Pending and cancelled orders are kept with their evidence without posting a fill. A partial order can post a fill when its execution is evidenced.

FIFO covers long option purchases and sales. A sale contributes realized P&L only for its matched quantity. Fills can arrive in separate images and in any upload order. The database matches them by execution time as more evidence is imported. The Dashboard and calendar count a matched sale as one closure on its sell date and each paired CSV summary as one closed trade on its source date. The calendar starts in the month of the latest closed trade and shows each month’s Gross P&L before fees, closed trade count, and win rate. A same-time tie with ambiguous ordering pauses allocation for that contract from the tie onward. Fees stay unknown where the evidence does not show them.

`npm test` checks the Dime changes against the migrations in an isolated test database with fixture extraction results. Set `JOURNAL_TEST_CSV` to run the original CSV reconciliation as well.
