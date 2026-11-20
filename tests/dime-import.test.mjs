import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { extractionSchema } from "../lib/dime.ts";
import { parseSummaryCsv } from "../lib/summary-csv.ts";

const owner = "8b40c760-923e-4ce7-9328-655641057a9a";
const other = "af5b6a2a-3b2c-4eea-ae9e-0c05211f0cb5";
const csv = "index,trade_id,date,underlying,option_type,strike,expiration,contracts,buy_time,buy_price,cost_usd,sell_time,sell_price,proceeds_usd,gross_pnl_usd,return_pct,status,source,verification_note\n0,1,2026-11-19,SPY,Call,700,2026-12-18,1,20:30:00,1.11,111.00,21:45:00,1.2,120.00,9.00,8.11,Win,original_csv,Checked";
const fill = {
  symbol: "SPY", option_type: "Call", strike: "710", expiration: "2026-12-18", day: "2026-11-19",
  clock: "20:30:00", side: "Buy", order_type: "Limit", status: "filled", quantity: 2,
  price: "1.50", fee: "1.00", fill_id: "buy-1", order_id: "order-1",
};

test("Dime evidence, uncertainty, repeat confirmation and CSV reconciliation", async (context) => {
  const db = new PGlite();
  context.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    insert into auth.users values ('${owner}'), ('${other}');
  `);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).sort()) await db.exec(await readFile(new URL(name, migrations), "utf8"));
  await db.exec("set role authenticated");
  const auth = (id) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await auth(owner);
  const { id: account } = (await db.query(
    "insert into trading_accounts(user_id,label,broker,currency,timezone) values ($1,'Fixture','Dime','USD','Asia/Bangkok') returning id",
    [owner],
  )).rows[0];
  const load = (raw) => db.query("select import_trade_summaries($1,'fixture.csv',$2,$3)", [account, raw, JSON.stringify(parseSummaryCsv(raw))]);
  const register = async (name) => (await db.query("select * from register_dime_image($1,$2,'image/png',$3)",
    [account, name, Buffer.from(name).toString("base64")])).rows[0];
  async function extract(image, values) {
    const { rows } = extractionSchema.parse({ rows: values });
    await db.query("select save_dime_extraction($1,'fixture',$2)", [image, JSON.stringify(rows)]);
    const { rows: records } = await db.query("select id from dime_records where image_id=$1 order by ordinal", [image]);
    return records.map((record, index) => ({ id: record.id, row: rows[index], resolution: "unresolved" }));
  }
  const confirm = async (image, rows) => (await db.query("select confirm_dime_records($1,$2) as count", [image, JSON.stringify(rows)])).rows[0].count;
  const totals = async () => (await db.query("select * from journal_totals($1)", [account])).rows[0];
  const history = async () => (await db.query("select * from dime_history($1)", [account])).rows;
  const overlap = async (row) => (await db.query("select dime_overlap($1,$2) as result", [account, JSON.stringify(row)])).rows[0].result;
  const dashboardTotals = async () => (await db.query("select * from journal_dashboard_totals($1)", [account])).rows[0];
  const closed = async (start, end) => (await db.query(
    "select day::text, source, gross::text, quantity, image_id from journal_closed_trades($1,$2,$3) order by day,id",
    [account, start, end],
  )).rows;

  assert.equal((await dashboardTotals()).latest_day, null);
  await load(csv);
  const baseline = { gross: "9.00", trades: 1, wins: 1, net: null };
  assert.deepEqual(await totals(), baseline);
  assert.deepEqual(await dashboardTotals(), { ...baseline, latest_day: new Date("2026-11-19") });

  const image = (await register("clear.png")).image_id;
  const pending = { ...fill, status: "pending", price: null, quantity: null, fill_id: null };
  const clear = await extract(image, [fill, pending]);
  assert.deepEqual(await totals(), baseline);
  assert.equal((await history()).length, 0);
  assert.equal(await confirm(image, clear), 2);
  assert.deepEqual(await totals(), baseline);
  assert.equal((await history())[0].open_quantity, "2");

  const editedImage = (await register("unclear.png")).image_id;
  const sale = { ...fill, day: "2026-12-05", price: null, side: "Sell", quantity: 1, clock: "21:01", fill_id: "sell-1", order_id: "order-2" };
  const corrected = await extract(editedImage, [sale]);
  await assert.rejects(confirm(editedImage, corrected));
  assert.deepEqual(await totals(), baseline);
  corrected[0].row.price = "2.25";
  assert.equal(await confirm(editedImage, corrected), 1);
  const afterSale = { gross: "84.00", trades: 2, wins: 2, net: null };
  assert.deepEqual(await totals(), afterSale);
  assert.deepEqual(await dashboardTotals(), { ...afterSale, latest_day: new Date("2026-12-05") });
  const november = await closed("2026-11-01", "2026-12-01");
  const december = await closed("2026-12-01", "2027-01-01");
  assert.deepEqual(november, [
    { day: "2026-11-19", source: "original_csv", gross: "9.00", quantity: 1, image_id: null },
  ]);
  assert.deepEqual(december, [
    { day: "2026-12-05", source: "dime", gross: "75.00", quantity: 1, image_id: editedImage },
  ]);
  assert.equal((await history()).find((row) => row.side === "Buy").open_quantity, "1");

  assert.deepEqual(await register("clear.png"), { image_id: image, extracted: true });
  assert.equal(await confirm(image, clear), 0);
  assert.equal(await confirm(editedImage, corrected), 0);
  assert.equal((await history()).length, 2);
  assert.deepEqual(await totals(), afterSale);

  const csvImage = (await register("csv-overlap.png")).image_id;
  const possible = { ...fill, strike: "700", fill_id: null, order_id: null };
  const flagged = await extract(csvImage, [possible]);
  assert.equal(await overlap(possible), "csv");
  await assert.rejects(confirm(csvImage, flagged), { code: "P0001" });
  flagged[0].resolution = "duplicate";
  assert.equal(await confirm(csvImage, flagged), 1);
  assert.equal(await confirm(csvImage, flagged), 0);
  assert.equal((await history()).length, 2);
  assert.deepEqual(await totals(), afterSale);

  const stable = (await register("same-fill-new-image.png")).image_id;
  const identified = await extract(stable, [fill]);
  assert.equal(await overlap(fill), "broker_id");
  await confirm(stable, identified);
  assert.equal((await history()).length, 2);
  await assert.rejects(load(csv.replace(",700,", ",710,")), { code: "P0001" });

  await auth(other);
  assert.equal((await db.query("select id from dime_images")).rows.length, 0);
  assert.equal((await history()).length, 0);
  assert.deepEqual(await closed("2026-11-01", "2027-01-01"), []);
  assert.equal((await dashboardTotals()).latest_day, null);
  await assert.rejects(confirm(image, clear), { code: "42501" });
  await db.exec("set role anon");
  await assert.rejects(closed("2026-11-01", "2027-01-01"), { code: "42501" });

  await context.test("calendar migration restores missing FIFO helpers in an existing database", async () => {
    const calendar = await readFile(new URL("202611200004_journal_calendar.sql", migrations), "utf8");
    await db.exec("reset role");
    await db.exec("drop function public.dime_realized(uuid), public.dime_allocations(uuid)");
    await db.exec(calendar);

    await db.exec("set role authenticated");
    await auth(owner);
    assert.deepEqual(await closed("2026-12-01", "2027-01-01"), december);
    assert.deepEqual(await dashboardTotals(), { ...afterSale, latest_day: new Date("2026-12-05") });
    assert.deepEqual(await totals(), afterSale);
    await auth(other);
    assert.deepEqual(await closed("2026-12-01", "2027-01-01"), []);
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from dime_realized($1)", [account]), { code: "42501" });
  });

  await context.test("auto-import skips known duplicates and matches sell-first uploads across months", async () => {
    await db.exec("set role authenticated");
    await auth(owner);

    const sellImage = (await register("auto-sell.png")).image_id;
    const freshSell = {
      ...fill, strike: "720", day: "2026-12-12", side: "Sell", price: "2.50",
      quantity: 2, fill_id: "auto-sell", order_id: "auto-sell-order",
    };
    const ambiguous = { ...fill, clock: "20:30", fill_id: null, order_id: null };
    const conflictingId = { ...fill, quantity: 9 };
    const csvOverlap = { ...fill, strike: "700", fill_id: "csv-overlap" };
    const partialWithoutId = { ...freshSell, status: "partial", fill_id: null };
    await extract(sellImage, [fill, ambiguous, conflictingId, csvOverlap, partialWithoutId, freshSell, freshSell, pending]);
    const autoImport = async (sourceImage) =>
      (await db.query("select * from auto_import_dime_image($1)", [sourceImage])).rows[0];

    const sellCounts = { imported: 1, duplicates: 2, needs_review: 4, unexecuted: 1 };
    assert.deepEqual(await autoImport(sellImage), sellCounts);
    assert.deepEqual(await autoImport(sellImage), sellCounts);
    assert.deepEqual(await totals(), afterSale);
    const waiting = (await history()).find((row) => row.image_id === sellImage);
    assert.equal(waiting.matched, null);
    assert.equal(waiting.gross, null);

    const buyImage = (await register("auto-buy-earlier.png")).image_id;
    const earlierBuy = { ...fill, strike: "720", price: "1.00", quantity: 1, fill_id: "auto-buy", order_id: "auto-buy-order" };
    await extract(buyImage, [earlierBuy, freshSell]);
    assert.deepEqual(await autoImport(buyImage), { imported: 1, duplicates: 1, needs_review: 0, unexecuted: 0 });
    const matched = (await history()).find((row) => row.image_id === sellImage);
    assert.equal(matched.matched, "1");
    assert.equal(matched.gross, "150.00");
    assert.deepEqual(await totals(), { gross: "234.00", trades: 3, wins: 3, net: null });

    const lastBuyImage = (await register("auto-buy-remaining.png")).image_id;
    await extract(lastBuyImage, [{ ...earlierBuy, day: "2026-12-10", price: "2.00", fill_id: "auto-buy-2" }]);
    assert.deepEqual(await autoImport(lastBuyImage), { imported: 1, duplicates: 0, needs_review: 0, unexecuted: 0 });
    assert.deepEqual(await closed("2026-12-01", "2027-01-01"), [
      ...december,
      { day: "2026-12-12", source: "dime", gross: "200.00", quantity: 2, image_id: sellImage },
    ]);

    await auth(other);
    await assert.rejects(autoImport(sellImage), { code: "42501" });
    await db.exec("set role anon");
    await assert.rejects(autoImport(sellImage), { code: "42501" });
  });
});
