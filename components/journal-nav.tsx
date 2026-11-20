"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DimeUpload } from "@/components/dime-upload";
import { ScreenshotImportDialog } from "@/components/screenshot-import-dialog";

const links = [
  { href: "/", label: "Dashboard", icon: "M3 3v18h18 M7 15l4-5 4 3 6-7" },
  { href: "/trade-history", label: "Trade History", icon: "M7 4h13v16H7z M4 7h6 M4 12h6 M4 17h6 M13 9h4 M13 15h4" },
  { href: "/imports", label: "Import", icon: "M12 16V4m-5 5 5-5 5 5 M4 17v3h16v-3" },
];

export function JournalNav() {
  const pathname = usePathname();
  const [modalOpen, setModalOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);

  function openImport(event: { preventDefault: () => void }) {
    if (pathname === "/imports") return;
    event.preventDefault();
    setModalOpen(true);
    if (account || loadingAccount) return;

    setLoadingAccount(true);
    fetch("/api/dime/account")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (typeof data?.id === "string") setAccount(data.id);
      })
      .catch(() => {})
      .finally(() => setLoadingAccount(false));
  }

  return <>
    <nav className="journal-nav" aria-label="Journal">
      {links.map(({ href, label, icon }) => {
        const isImport = href === "/imports";
        const isCurrent = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
        return (
          <Link href={href} key={href} prefetch={href === "/" ? undefined : false}
            aria-current={isCurrent ? "page" : undefined}
            aria-haspopup={isImport ? "dialog" : undefined}
            aria-expanded={isImport ? modalOpen : undefined}
            onNavigate={isImport ? openImport : undefined}
            className="touch-manipulation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={icon} />
            </svg>
            {label}
          </Link>
        );
      })}
    </nav>
    <ScreenshotImportDialog open={modalOpen} onDismiss={() => setModalOpen(false)}>
      {(onImported) => loadingAccount ? <p role="status" className="muted py-6 text-center">Connecting to Dime account…</p> :
        account ? <DimeUpload account={account} active={modalOpen} onImported={onImported} /> :
          <div className="grid gap-2">
            <p role="alert">Could not load Dime account.</p>
            <Link href="/imports" className="text-link underline" onClick={() => setModalOpen(false)}>Open the Import page</Link>
          </div>}
    </ScreenshotImportDialog>
  </>;
}
