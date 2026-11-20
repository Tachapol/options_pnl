import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export async function serverClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const jar = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          for (const { name, value, options } of values) jar.set(name, value, options);
        } catch {
          // Server Components rely on the proxy to refresh cookies.
        }
      },
    },
  });
}
