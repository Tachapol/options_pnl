import { getDimeAccount } from "@/lib/dime-account";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    const { client } = await requireSession();
    const { data: account, error } = await getDimeAccount(client);
    if (error || !account) {
      return Response.json({ error: "No Dime account found." }, { status: 404 });
    }
    return Response.json(account, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
