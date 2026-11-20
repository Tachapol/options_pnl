"use client";

import { useEffect, useRef, useState } from "react";
import { useImportModal } from "@/components/import-modal-context";
import { DimeUpload } from "@/components/dime-upload";

export function GlobalImportModal({ account: fallbackAccount }: { account?: string }) {
  const { isOpen, accountId, closeModal } = useImportModal();
  const [activeAccount, setActiveAccount] = useState<string | undefined>(accountId || fallbackAccount);
  const [loading, setLoading] = useState(!accountId && !fallbackAccount);
  const cardRef = useRef<HTMLDivElement>(null);

  // Sync if account changes
  useEffect(() => {
    if (accountId) {
      setActiveAccount(accountId);
      setLoading(false);
    } else if (fallbackAccount) {
      setActiveAccount(fallbackAccount);
      setLoading(false);
    }
  }, [accountId, fallbackAccount]);

  // Fetch account if not provided
  useEffect(() => {
    if (isOpen && !activeAccount) {
      setLoading(true);
      fetch("/api/dime/account")
        .then((res) => res.json())
        .then((data) => {
          if (data?.id) setActiveAccount(data.id);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [isOpen, activeAccount]);

  // Listen for Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeModal]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div ref={cardRef} className="modal-card p-5 sm:p-6" tabIndex={-1}>
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-border mb-4">
          <div>
            <h2 id="import-modal-title" className="text-lg font-semibold leading-tight">Import Screenshots</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Upload Dime trade fills or orders to record your journal</p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close dialog"
            className="grid place-items-center w-10 h-10 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer text-base font-semibold"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">
            Connecting to Dime account…
          </div>
        ) : activeAccount ? (
          <DimeUpload account={activeAccount} />
        ) : (
          <p role="alert" className="notice">
            No Dime USD account found. Please check your account settings.
          </p>
        )}
      </div>
    </div>
  );
}
