"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fillSchema, missingFields } from "@/lib/dime";
import { requireSession } from "@/lib/session";

const reviewsSchema = z.array(z.object({
  id: z.uuid(),
  row: fillSchema,
  resolution: z.enum(["unresolved", "duplicate", "distinct"]),
})).min(1).max(40);

export async function confirmDime(image: string, input: unknown) {
  const parsed = reviewsSchema.safeParse(input);
  if (!z.uuid().safeParse(image).success || !parsed.success) return { error: "Check the highlighted fields." };
  for (const { row, resolution } of parsed.data) {
    if (resolution === "duplicate" || row.status === "pending" || row.status === "cancelled") continue;
    if (missingFields(row).length || (row.side !== "Buy" && row.side !== "Sell")) {
      return { error: "Review all required execution fields first." };
    }
  }
  const { client } = await requireSession();
  const { data, error } = await client.rpc("confirm_dime_records", { source_image: image, reviews: parsed.data });
  if (error?.code === "P0001") {
    const [overlapId, kind] = (error.details || "").split(":");
    return { error: "An overlap needs review. Compare the flagged item and try again.", overlapId,
      overlap: kind === "csv" ? "csv" as const : "fill" as const };
  }
  if (error) return { error: "Could not save these items. No changes were applied." };
  revalidatePath("/");
  revalidatePath("/imports");
  revalidatePath("/trade-history");
  revalidatePath(`/imports/dime/${image}`);
  const { data: decisions } = await client.from("dime_records").select("id,decision")
    .eq("image_id", image);
  return { count: Number(data), decisions: decisions ?? [] };
}
