import test from "node:test";
import assert from "node:assert/strict";
import { executionTotal, formatExecutionTime, holdingDuration, summaryExecutions } from "../lib/trade-executions.ts";

const summary = {
  sessionDate: "2026-11-19", quantity: 4,
  buy_time: "00:00:40 (Nov 20)", sell_time: "00:01:12 / 00:04:06 (Nov 20)",
  buy_price: "3.31", sell_price: "5.5775",
};
const evidence = {
  note: "Trade occurs after midnight Nov 20; assigned to Nov 19 session; sell 1 at 3.41 and 3 at 6.30",
  cost: "1324.00", proceeds: "2231.00",
};

test("shows both verified sells on Nov 20 while preserving the Nov 19 session", () => {
  const executions = summaryExecutions(summary, evidence, "Asia/Bangkok");
  assert.equal(summary.sessionDate, "2026-11-19");
  assert.deepEqual(executions.map(({ side, quantity, price, executedAt }) => [side, quantity, price, executedAt]), [
    ["Buy", 4, "3.31", "2026-11-19T17:00:40.000Z"],
    ["Sell", 1, "3.41", "2026-11-19T17:01:12.000Z"],
    ["Sell", 3, "6.30", "2026-11-19T17:04:06.000Z"],
  ]);
  assert.deepEqual(executions.map(formatExecutionTime), [
    "20 Nov · 00:00:40", "20 Nov · 00:01:12", "20 Nov · 00:04:06",
  ]);
  assert.deepEqual(executions.map(executionTotal), [132400n, 34100n, 189000n]);
  assert.equal(holdingDuration(executions), "3m 26s");
});

test("retains execution times without using averaged prices or inventing fill sizes", () => {
  for (const source of [undefined, { ...evidence, proceeds: "2230.99" },
    { ...evidence, note: "sell 2 at 3.41 and 2 at 6.30" }]) {
    const executions = summaryExecutions(summary, source, "Asia/Bangkok");
    assert.deepEqual(executions.slice(1).map(({ quantity, price }) => [quantity, price]), [[null, null], [null, null]]);
    assert.equal(executionTotal(executions[1]), null);
    assert.equal(holdingDuration(executions), "3m 26s");
  }
});

test("uses the first entry and last exit across midnight and year boundaries", () => {
  const executions = summaryExecutions({
    ...summary, sessionDate: "2026-12-31", buy_time: "23:59:45 / 23:59:50",
    sell_time: "23:59:55 / 00:00:03 (Jan 1)",
  }, undefined, "Asia/Bangkok");
  assert.deepEqual(executions.map(({ localDate }) => localDate), [
    "2026-12-31", "2026-12-31", "2026-12-31", "2027-01-01",
  ]);
  assert.equal(holdingDuration(executions), "18s");
});

test("preserves ambiguous wall times without manufacturing a duration across a DST fold", () => {
  const executions = summaryExecutions({
    ...summary, sessionDate: "2026-11-01", buy_time: "01:15:00", sell_time: "02:15:00",
  }, undefined, "America/New_York");
  assert.equal(executions[0].executedAt, null);
  assert.equal(executions[1].executedAt, "2026-11-01T07:15:00.000Z");
  assert.equal(holdingDuration(executions), null);
});
