import { DimeUpload } from "@/components/dime-upload";
import { getDimeAccount } from "@/lib/dime-account";
import { requireSession } from "@/lib/session";

export default async function Imports() {
  const { client } = await requireSession();
  const { data: account, error } = await getDimeAccount(client);

  return <>
    <header className="page-header"><h1>Import</h1></header>
    {account ? <DimeUpload key={account.id} account={account.id} /> :
      <p role="alert" className="notice">{error ? "Could not load the Dime account." : "No Dime USD account is configured for this journal."}</p>}
  </>;
}
