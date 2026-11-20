import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { fillSchema } from "@/lib/dime";
import { requireSession } from "@/lib/session";
import { DimeImagePreview } from "@/components/dime-image-preview";
import { DimeReview, type ReviewRecord } from "./review";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [image, records] = await Promise.all([
    client.from("dime_images").select("filename,account_id,trading_accounts(timezone)").eq("id", id.data)
      .maybeSingle<{ filename: string; account_id: string; trading_accounts: { timezone: string } }>(),
    client.from("dime_records").select("id,ordinal,extracted,verified,decision").eq("image_id", id.data).order("ordinal"),
  ]);
  if (!image.data) notFound();
  const account = image.data.account_id;
  const rows: ReviewRecord[] = await Promise.all((records.data ?? []).map(async (record) => {
    const parsed = fillSchema.safeParse(record.verified ?? record.extracted);
    const row = parsed.success ? parsed.data : fillSchema.parse(Object.fromEntries(
      Object.keys(fillSchema.shape).map((key) => [key, null]),
    ));
    const overlap = !record.decision && row.status !== "pending" && row.status !== "cancelled"
      ? await client.rpc("dime_overlap", { target_account: account, candidate: row }) : null;
    let evidence: string[] | undefined;
    if (overlap?.data === "csv" && row.day && row.symbol && row.option_type && row.strike && row.expiration) {
      const date = Date.parse(row.day);
      const dayOffset = (offset: number) => new Date(date + offset * 86_400_000).toISOString().slice(0, 10);
      const { data: summaries } = await client.from("trade_summaries")
        .select("day,quantity,buy_time,buy_price,sell_time,sell_price")
        .eq("account_id", account).eq("symbol", row.symbol).eq("option_type", row.option_type)
        .eq("strike", row.strike).eq("expiration", row.expiration).gte("day", dayOffset(-1)).lte("day", dayOffset(1))
        .order("day", { ascending: false }).limit(5);
      evidence = summaries?.map((item) =>
        `${item.day} · ${item.quantity} contracts · Buy ${item.buy_time} @ $${item.buy_price} · Sell ${item.sell_time} @ $${item.sell_price}`);
    }
    return { id: record.id, ordinal: record.ordinal, decision: record.decision, row,
      overlap: overlap?.data ?? null, evidence };
  }));
  return (
    <>
      <header className="page-header">
        <Link href="/imports" className="text-sm text-link underline">Import Center</Link>
        <h1 className="mt-2">Review Dime screenshot</h1>
        <p className="muted break-words">{image.data.filename} · Source clock {image.data.trading_accounts.timezone}</p>
      </header>
      {records.error && <p className="notice" role="alert">Could not load extracted items.</p>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card className="lg:sticky lg:top-4">
          <CardContent className="py-4">
            <DimeImagePreview src={`/api/dime/${id.data}`} alt={image.data.filename} />
          </CardContent>
        </Card>
        <DimeReview image={id.data} account={account} records={rows} />
      </div>
    </>
  );
}
