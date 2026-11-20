"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { DimeUpload } from "@/components/dime-upload";
import { ScreenshotImportDialog } from "@/components/screenshot-import-dialog";

export function DimeImportModal({ account, initiallyOpen, fallbackHref }: {
  account: string;
  initiallyOpen: boolean;
  fallbackHref: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  function dismiss() {
    setOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has("import")) {
      url.searchParams.delete("import");
      window.history.replaceState(null, "", url);
    }
  }

  return <>
    <Link href={fallbackHref} prefetch={false} className={buttonVariants({ className: "touch-manipulation" })}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setOpen(true);
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mr-1.5">
        <path d="M12 16V4m-5 5 5-5 5 5 M4 17v3h16v-3" />
      </svg>
      Import screenshots
    </Link>
    <ScreenshotImportDialog open={open} onDismiss={dismiss}>
      {(onImported) => <DimeUpload account={account} active={open} onImported={onImported} />}
    </ScreenshotImportDialog>
  </>;
}
