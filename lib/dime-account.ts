import type { SupabaseClient } from "@supabase/supabase-js";

export function getDimeAccount(client: SupabaseClient, accountId?: string) {
  const query = client.from("trading_accounts").select("id,label,timezone").eq("currency", "USD").ilike("broker", "dime");
  if (accountId) return query.eq("id", accountId).maybeSingle();
  return query.order("created_at").order("id").limit(1).maybeSingle();
}
