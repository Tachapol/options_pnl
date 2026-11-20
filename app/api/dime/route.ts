import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { extractDime } from "@/lib/dime-vision";
import { z } from "zod";

export const maxDuration = 65;
const maxImage = 8 * 1024 * 1024;

function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  const { client } = await requireSession();
  if (Number(request.headers.get("content-length")) > maxImage + 16384) {
    return Response.json({ error: "Use an image up to 8 MB." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const account = z.uuid().safeParse(form?.get("account"));
  const file = form?.get("image");
  if (!account.success || !(file instanceof File) || !file.size || file.size > maxImage) {
    return Response.json({ error: "Choose a Dime account and an image up to 8 MB." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = imageType(bytes);
  if (!mime) return Response.json({ error: "Choose a PNG, JPEG or WebP screenshot." }, { status: 400 });

  const encoded = bytes.toString("base64");
  const { data, error } = await client.rpc("register_dime_image", {
    target_account: account.data, source_filename: file.name.slice(0, 255) || "Dime screenshot",
    source_mime: mime, source_bytes: encoded,
  }).single<{ image_id: string; extracted: boolean }>();
  if (error || !data) return Response.json({ error: "Could not save the image. Check the account and import migration." }, { status: 502 });
  if (!data.extracted) {
    try {
      const result = await extractDime(`data:${mime};base64,${encoded}`);
      const saved = await client.rpc("save_dime_extraction", {
        source_image: data.image_id, vision_model: result.model, extracted_rows: result.rows,
      });
      if (saved.error) return Response.json({ error: "Could not save the extraction. Retry this image." }, { status: 502 });
    } catch (error) {
      const message = error instanceof Error && /^(Vision|No Dime)/.test(error.message)
        ? error.message : "Could not read this image. Retry it individually.";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  const { data: counts, error: importError } = await client.rpc("auto_import_dime_image", {
    source_image: data.image_id,
  }).single<{ imported: number; duplicates: number; needs_review: number; unexecuted: number }>();
  if (importError || !counts) {
    const message = importError?.code === "PGRST202"
      ? "Screenshot read. Apply the Dime auto-import migration, then retry this image."
      : "Screenshot read, but the trades could not be imported. Retry this image.";
    return Response.json({ error: message, id: data.image_id }, { status: 502 });
  }

  revalidatePath(`/imports/dime/${data.image_id}`);
  if (counts.imported) {
    revalidatePath("/");
    revalidatePath("/trade-history");
  }
  return Response.json({ id: data.image_id, duplicate: data.extracted, ...counts });
}
