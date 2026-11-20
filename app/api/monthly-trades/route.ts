import { getDimeAccount } from "@/lib/dime-account";
import { isJournalMonth } from "@/lib/journal-month";
import { getMonthlyTrades } from "@/lib/monthly-trades";
import { requireSession } from "@/lib/session";
import { z } from "zod";

export async function GET(request: Request) {
  const { client } = await requireSession();
  const params = new URL(request.url).searchParams;
  const account = z.uuid().safeParse(params.get("account"));
  const month = params.get("month");
  if (!account.success || !isJournalMonth(month)) {
    return Response.json({ error: "Invalid account or month." }, { status: 400 });
  }

  const { data: dimeAccount, error } = await getDimeAccount(client, account.data);
  if (error) return Response.json({ error: "Could not load the Dime account." }, { status: 502 });
  if (!dimeAccount) return Response.json({ error: "Dime account unavailable." }, { status: 404 });
  const trades = await getMonthlyTrades(client, account.data, month, dimeAccount.timezone);
  if (!trades) return Response.json({ error: "Monthly trades could not be loaded." }, { status: 502 });
  return Response.json(trades, { headers: { "Cache-Control": "private, no-store" } });
}
