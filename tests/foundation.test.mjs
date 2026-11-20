import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("migration enforces two-user isolation and writes a protected account audit event", async () => {
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
    await db.exec(await readFile(new URL("../supabase/migrations/202611200001_foundation.sql", import.meta.url), "utf8"));
    await db.exec("set role authenticated");
    const switchUser = (id) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const insert = (id, name, timezone) => db.query(
      "insert into trading_accounts (user_id,label,broker,currency,timezone) values ($1,$2,'Dime','USD',$3)",
      [id, name, timezone],
    );
    await switchUser(alice);
    await insert(alice, "Personal options", "Asia/Bangkok");
    await assert.rejects(insert(alice, "personal options", "Asia/Bangkok"), { code: "23505" });
    await assert.rejects(insert(alice, "Other options", "Mars/Olympus"), { code: "22023" });
    await assert.rejects(insert(bob, "Forged owner", "Asia/Bangkok"), { code: "42501" });
    assert.deepEqual((await db.query("select actor_id,event_type from audit_logs")).rows,
      [{ actor_id: alice, event_type: "account.created" }]);
    await assert.rejects(db.exec("delete from audit_logs"), { code: "42501" });
    await switchUser(bob);
    assert.equal((await db.query("select id from trading_accounts")).rows.length, 0);
    assert.equal((await db.query("select id from audit_logs")).rows.length, 0);
    await insert(bob, "Personal options", "America/New_York");
    assert.deepEqual((await db.query("select user_id from trading_accounts")).rows, [{ user_id: bob }]);
    await db.exec("set role anon");
    await assert.rejects(db.query("select id from trading_accounts"), { code: "42501" });
  } finally {
    await db.close();
  }
});
