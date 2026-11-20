"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { serverClient } from "../../lib/supabase";

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export async function signIn(form: FormData) {
  const result = credentials.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!result.success) redirect("/sign-in?error=invalid");
  const client = await serverClient();
  if (!client) redirect("/sign-in");
  const { error } = await client.auth.signInWithPassword(result.data);
  if (error) redirect("/sign-in?error=credentials");
  redirect("/");
}

export async function signOut() {
  const client = await serverClient();
  if (client) {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) redirect("/?error=sign-out");
  }
  redirect("/sign-in");
}
