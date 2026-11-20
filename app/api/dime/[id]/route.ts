import { z } from "zod";
import { requireSession } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const { data } = await client.from("dime_images").select("mime,bytes").eq("id", id.data).maybeSingle();
  if (!data) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(data.bytes.slice(2), "hex")), {
    headers: { "Content-Type": data.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
