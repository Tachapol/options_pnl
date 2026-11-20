import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseSummaryCsv, cents, signedUsd } from "../lib/summary-csv.ts";

const header = "index,trade_id,date,underlying,option_type,strike,expiration,contracts,buy_time,buy_price,cost_usd,sell_time,sell_price,proceeds_usd,gross_pnl_usd,return_pct,status,source,verification_note";
const row = '0,1,2026-11-19,SPY,Call,700,2026-11-20,1,20:30:00,1.111,111.05,21:45:00,1.2,120.00,8.95,8.06,Win,original_csv,"Source amounts, checked"';
const csv = header + "\r\n" + row;

test("parser preserves quoted evidence and checks exact source amount arithmetic", () => {
  const [trade] = parseSummaryCsv(csv);
  assert.equal(trade.note, "Source amounts, checked");
  assert.equal(trade.cost, "111.05");
  assert.equal(trade.buy_price, "1.111");
  assert.equal(signedUsd(cents(trade.gross)), "+$8.95");
  assert.throws(() => parseSummaryCsv(csv.replace("8.95", "8.90")), /does not match/);
  assert.throws(() => parseSummaryCsv(csv + "\n" + row), /duplicate trade ID/);
  assert.throws(() => parseSummaryCsv(csv.replace("2026-11-19", "2026-02-30")), /Invalid date/);
});

test("import is atomic, scoped to account owner and idempotent", async () => {
  const db = new PGlite();
  const alice = "8b40c760-923e-4ce7-9328-655641057a9a";
  const bob = "af5b6a2a-3b2c-4eea-ae9e-0c05211f0cb5";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to authenticated;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      insert into auth.users values ('${alice}'), ('${bob}');
    `);
    for (const file of ["202611200001_foundation.sql", "202611200002_summary_import.sql"]) {
      await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
    }
    await db.exec("set role authenticated");
    const authenticate = (id) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await authenticate(alice);
    const { rows: [{ id }] } = await db.query(
      "insert into trading_accounts (user_id,label,broker,currency,timezone) values ($1,'Personal','Dime','USD','Asia/Bangkok') returning id", [alice],
    );
    const load = (source) => db.query("select import_trade_summaries($1,$2,$3,$4) as result",
      [id, "source.csv", source, JSON.stringify(parseSummaryCsv(source))]);
    assert.equal((await load(csv)).rows[0].result, "imported");
    assert.equal((await load(csv)).rows[0].result, "duplicate");
    await assert.rejects(load(csv.replace("amounts, checked", "amounts, verified")), { code: "P0001" });
    assert.deepEqual((await db.query("select * from trade_summary_totals($1)", [id])).rows,
      [{ gross: "8.95", trades: 1, wins: 1, losses: 0 }]);
    assert.equal((await db.query("select id from summary_imports")).rows.length, 1);
    assert.equal((await db.query("select id from audit_logs where event_type = 'summary.imported'")).rows.length, 1);
    if (process.env.JOURNAL_TEST_CSV) {
      const raw = await readFile(process.env.JOURNAL_TEST_CSV, "utf8");
      const dataset = parseSummaryCsv(raw);
      const { rows: [{ id: datasetAccount }] } = await db.query(
        "insert into trading_accounts (user_id,label,broker,currency,timezone) values ($1,'Validation','Dime','USD','Asia/Bangkok') returning id", [alice],
      );
      const args = [datasetAccount, "dataset.csv", raw, JSON.stringify(dataset)];
      const query = "select import_trade_summaries($1,$2,$3,$4) as result";
      assert.equal((await db.query(query, args)).rows[0].result, "imported");
      assert.equal((await db.query(query, args)).rows[0].result, "duplicate");
      const totals = (await db.query("select * from trade_summary_totals($1)", [datasetAccount])).rows[0];
      assert.equal(totals.trades, dataset.length);
      assert.equal(cents(totals.gross), dataset.reduce((total, trade) => total + cents(trade.gross), 0n));
    }
    await authenticate(bob);
    assert.equal((await db.query("select id from summary_imports")).rows.length, 0);
    assert.equal((await db.query("select import_id from trade_summaries")).rows.length, 0);
    await assert.rejects(load(csv), { code: "42501" });
  } finally {
    await db.close();
  }
});

if (process.env.JOURNAL_TEST_CSV) {
  test("private SPY dataset parses and reconciles", async () => {
    const trades = parseSummaryCsv(await readFile(process.env.JOURNAL_TEST_CSV, "utf8"));
    assert.ok(trades.length > 0);
  });
}
