"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function ScreenshotImportDialog({ open, children, onDismiss }: {
  open: boolean;
  children: (onImported: () => void) => ReactNode;
  onDismiss: () => void;
}) {
  const [initialMarkupOpen] = useState(open);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const refreshPending = useRef(false);
  const titleId = useId();
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    // Upgrade the server-rendered open dialog to the native top layer.
    if (!dialog.matches(":modal")) {
      dialog.removeAttribute("open");
      dialog.showModal();
    }
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function onImported() {
    if (dialogRef.current?.open) refreshPending.current = true;
    else router.refresh();
  }

  function dismiss() {
    onDismiss();
    if (refreshPending.current) {
      refreshPending.current = false;
      router.refresh();
    }
  }

  return <dialog ref={dialogRef} open={initialMarkupOpen} className="screenshot-import-dialog" aria-labelledby={titleId}
    onCancel={(event) => {
      // Cancel from the photo picker can bubble up from the file input.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      dismiss();
    }}>
    <div className="p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <h2 id={titleId} className="text-lg font-semibold">Import Screenshots</h2>
        <button type="button" aria-label="Close dialog" onClick={dismiss}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-border muted hover:bg-muted">
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      {children(onImported)}
    </div>
  </dialog>;
}
