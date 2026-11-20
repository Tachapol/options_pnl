import { cache } from "react";
import { redirect } from "next/navigation";
import { serverClient } from "./supabase";

export const requireSession = cache(async () => {
  const client = await serverClient();
  if (!client) redirect("/sign-in");
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) redirect("/sign-in");
  return { client, userId: data.claims.sub };
});
