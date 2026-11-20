import { z } from "zod";
import { requireSession } from "@/lib/session";

export async function GET(request: Request) {
  const account = z.uuid().safeParse(new URL(request.url).searchParams.get("account"));
  if (!account.success) return Response.json({ error: "Invalid Dime account." }, { status: 400 });

  const { client } = await requireSession();
  const { data, error } = await client.from("dime_images")
    .select("id,filename,model,dime_records(decision)")
    .eq("account_id", account.data).order("created_at", { ascending: false }).order("id").limit(10);
  if (error) return Response.json({ error: "Could not load recent uploads." }, { status: 502 });

  return Response.json(data.map((image) => {
    const counts = { imported: 0, duplicates: 0, needs_review: 0, unexecuted: 0 };
    for (const { decision } of image.dime_records ?? []) {
      if (decision === "confirmed") counts.imported++;
      else if (decision === "duplicate") counts.duplicates++;
      else if (decision === "unexecuted") counts.unexecuted++;
      else counts.needs_review++;
    }
    return { id: image.id, filename: image.filename, extracted: image.model !== null, ...counts };
  }), { headers: { "Cache-Control": "private, no-store" } });
}
