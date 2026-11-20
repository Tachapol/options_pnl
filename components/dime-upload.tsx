"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { optimizeScreenshot } from "@/lib/image-compress";

type Item = {
  key: string;
  file: File;
  account: string;
  preview: string;
  state: string;
  step?: "optimizing" | "analyzing" | "done" | "error";
  id?: string;
  failed?: boolean;
  duplicate?: boolean;
  needsReview?: number;
  importedCount?: number;
};

type UploadCounts = { imported: number; duplicates: number; needs_review: number; unexecuted: number };
type RecentUpload = UploadCounts & { id: string; filename: string; extracted: boolean; created_at?: string };

function formatUploadStatus(result: UploadCounts) {
  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} imported`);
  if (result.duplicates > 0) parts.push(`${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped`);
  if (result.needs_review > 0) parts.push(`${result.needs_review} to review`);
  if (result.unexecuted > 0) parts.push(`${result.unexecuted} unexecuted`);
  return parts.join(" · ") || "No trades detected";
}

export function DimeUpload({ account, active = true, onImported }: {
  account: string;
  active?: boolean;
  onImported?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [validation, setValidation] = useState("");
  const [recent, setRecent] = useState<RecentUpload[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<"all" | "review" | "done">("all");
  const [previewModalImg, setPreviewModalImg] = useState<string | null>(null);
  const previews = useRef<string[]>([]);
  const nextKey = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ account });
    fetch(`/api/dime/recent?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : [])
      .then((uploads) => {
        if (!controller.signal.aborted) setRecent(Array.isArray(uploads) ? uploads : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [account, active]);

  async function upload(item: Item) {
    const update = (change: Partial<Item>) => setItems((rows) =>
      rows.map((row) => row.key === item.key ? { ...row, ...change } : row));

    try {
      let fileToUpload = item.file;
      const isStandardSmall = (fileToUpload.type === "image/png" || fileToUpload.type === "image/jpeg" || fileToUpload.type === "image/webp") && fileToUpload.size <= 1024 * 1024;

      if (!isStandardSmall) {
        update({ state: "Optimizing image…", step: "optimizing", failed: false });
        fileToUpload = await optimizeScreenshot(item.file);
      }

      update({ state: "Extracting with Vision AI…", step: "analyzing", failed: false });
      const form = new FormData();
      form.set("image", fileToUpload);
      if (item.account) {
        form.set("account", item.account);
      }
      const response = await fetch("/api/dime", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        update({ id: result.id, state: result.error || "Upload failed.", step: "error", failed: true });
        return false;
      }
      const summary = formatUploadStatus(result);
      update({
        id: result.id,
        duplicate: result.duplicate,
        needsReview: result.needs_review,
        importedCount: result.imported,
        step: "done",
        state: result.duplicate ? `Already uploaded · ${summary}` : summary,
      });
      return result.imported > 0;
    } catch (error) {
      update({ state: error instanceof Error ? error.message : "Upload failed.", step: "error", failed: true });
      return false;
    }
  }

  async function queue(files: File[]) {
    if (!files.length) return;
    const isImage = (file: File) =>
      file.type.startsWith("image/") || /\.(?:png|jpe?g|webp|heic|heif)$/i.test(file.name);

    const supported = files.filter((file) => isImage(file) && file.size > 0 && file.size <= 30 * 1024 * 1024);

    if (supported.length !== files.length) {
      setValidation("Please choose image files (PNG, JPEG, WebP, HEIC) up to 30 MB each.");
    } else {
      setValidation("");
    }

    const batch = supported.map((file): Item => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { key: String(nextKey.current++), file, preview, account, state: "Queued", step: "optimizing" };
    });
    setItems((rows) => [...rows, ...batch]);
    let imported = false;
    for (const image of batch) {
      if (await upload(image)) imported = true;
    }
    if (imported) onImported?.();
  }

  const isUploading = items.some((item) => item.step === "optimizing" || item.step === "analyzing");
  const completedCount = items.filter((item) => item.step === "done" || item.step === "error").length;
  const totalCount = items.length;

  const earlierUploads = recent.filter((upload) => !items.some((item) => item.id === upload.id));
  const reviewPendingCount = earlierUploads.filter((u) => u.needs_review > 0).length;

  const filteredEarlier = useMemo(() => {
    if (filter === "review") return earlierUploads.filter((u) => u.needs_review > 0);
    if (filter === "done") return earlierUploads.filter((u) => u.needs_review === 0 && u.extracted);
    return earlierUploads;
  }, [earlierUploads, filter]);

  return (
    <div className="grid gap-5">
      {/* ─── Compact, Beautiful Dropzone ───────────────────────────── */}
      <div
        className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-all ${
          dragging
            ? "border-emerald-500 bg-emerald-500/10 scale-[1.01]"
            : "border-border hover:border-emerald-500/50 hover:bg-card/60 bg-card/30"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDragEnd={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void queue(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="Upload Dime screenshots"
          className="sr-only"
          onChange={(event) => {
            void queue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take screenshot photo"
          className="sr-only"
          onChange={(event) => {
            void queue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />

        <div className="mx-auto flex max-w-md flex-col items-center">
          <div className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
              <line x1="16" y1="5" x2="22" y2="5" />
              <line x1="19" y1="2" x2="19" y2="8" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>

          <h3 className="text-base sm:text-lg font-semibold tracking-tight">Upload Dime Screenshots</h3>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Drop screenshots here, or select files from your device. AI extracts contracts, executions & FIFO matching automatically.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-11 px-5 font-semibold gap-2 shadow-xs cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4m-5 5 5-5 5 5 M4 17v3h16v-3" />
              </svg>
              Choose Photos
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => cameraInputRef.current?.click()}
              className="min-h-11 px-4 text-xs sm:text-sm gap-2 cursor-pointer sm:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                <circle cx="12" cy="13" r="3"/>
              </svg>
              Camera
            </Button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded bg-muted/60 px-2 py-0.5 font-mono">PNG</span>
            <span className="rounded bg-muted/60 px-2 py-0.5 font-mono">JPG</span>
            <span className="rounded bg-muted/60 px-2 py-0.5 font-mono">WebP</span>
            <span className="rounded bg-muted/60 px-2 py-0.5 font-mono">HEIC</span>
            <span>· Max 30 MB / image</span>
          </div>
        </div>
      </div>

      {validation && (
        <div role="alert" className="notice flex items-center gap-2 text-sm">
          <span aria-hidden="true">⚠</span>
          <span>{validation}</span>
        </div>
      )}

      {/* ─── Batch Progress Bar (Semantic <progress>) ─────────────── */}
      {isUploading && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs sm:text-sm mb-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="font-semibold text-foreground">Processing screenshots</span>
            </div>
            <span className="text-muted-foreground font-mono">
              {completedCount} of {totalCount} completed
            </span>
          </div>
          <progress
            className="modern-progress"
            value={totalCount ? completedCount : undefined}
            max={totalCount || 1}
            aria-label="Upload and extraction progress"
          />
        </div>
      )}

      {/* ─── Currently Uploaded Items ───────────────────────────────── */}
      {items.length > 0 && (
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Current Uploads ({items.length})
            </h4>
            {completedCount === totalCount && (
              <button
                type="button"
                onClick={() => setItems([])}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline"
              >
                Clear completed
              </button>
            )}
          </div>

          <div className="grid gap-2">
            {items.map((item) => {
              const isWorking = item.step === "optimizing" || item.step === "analyzing";
              const isSuccess = item.step === "done" && !item.failed && !item.needsReview;
              const hasReview = Boolean(item.needsReview && item.needsReview > 0);

              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3.5 rounded-xl border border-border bg-card/80 p-3 sm:p-4 shadow-xs transition-colors hover:border-border"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewModalImg(item.preview)}
                    aria-label="Preview full screenshot"
                    className="relative h-14 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-black/10 cursor-zoom-in group"
                  >
                    <img src={item.preview} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <span className="text-white text-xs">🔍</span>
                    </div>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="truncate text-xs sm:text-sm font-semibold text-foreground max-w-[200px] sm:max-w-xs">
                        {item.file.name}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {isWorking && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                          {item.state}
                        </span>
                      )}

                      {isSuccess && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500 border border-emerald-500/20">
                          <span aria-hidden="true">✓</span>
                          {item.state}
                        </span>
                      )}

                      {hasReview && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-500 border border-amber-500/20">
                          <span aria-hidden="true">⚠</span>
                          {item.needsReview} item{item.needsReview === 1 ? "" : "s"} need confirmation
                        </span>
                      )}

                      {item.failed && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-500 border border-rose-500/20">
                          <span aria-hidden="true">✕</span>
                          {item.state}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {hasReview && item.id && (
                      <Link
                        href={`/imports/dime/${item.id}`}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-400 shadow-xs"
                      >
                        Review Now →
                      </Link>
                    )}

                    {!hasReview && item.id && (
                      <Link
                        href={`/imports/dime/${item.id}`}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        View
                      </Link>
                    )}

                    {item.failed && (
                      <Button
                        variant="outline"
                        className="min-h-10 px-3 text-xs"
                        onClick={async () => {
                          if (await upload(item)) onImported?.();
                        }}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Recent Uploads / History Feed ─────────────────────────── */}
      {earlierUploads.length > 0 && (
        <section aria-label="Recent screenshot uploads" className="grid gap-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Upload History</h3>
              {reviewPendingCount > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-500 border border-amber-500/20">
                  {reviewPendingCount} unconfirmed
                </span>
              )}
            </div>

            {/* Filter segmented pills */}
            <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1 text-xs">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  filter === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({earlierUploads.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("review")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  filter === "review" ? "bg-card text-amber-500 font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                To Review ({reviewPendingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("done")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  filter === "done" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Completed
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            {filteredEarlier.map((upload) => {
              const needsAction = upload.needs_review > 0;
              return (
                <div
                  key={upload.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                    needsAction
                      ? "border-amber-500/30 bg-amber-500/[0.03] hover:border-amber-500/50"
                      : "border-border bg-card/60 hover:border-border"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-xs sm:text-sm font-semibold text-foreground">
                        {upload.filename}
                      </strong>
                      {needsAction ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                          Needs Review
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                          Completed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {upload.extracted
                        ? formatUploadStatus(upload)
                        : "Screenshot saved. Tap to finish processing."}
                    </p>
                  </div>

                  <Link
                    href={`/imports/dime/${upload.id}`}
                    prefetch={false}
                    className={`inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                      needsAction
                        ? "bg-amber-500 text-black hover:bg-amber-400 shadow-xs"
                        : "border border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    {needsAction ? "Review Trades →" : "View Details"}
                  </Link>
                </div>
              );
            })}

            {filteredEarlier.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No uploads match this filter.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ─── Instant Thumbnail Preview Modal ───────────────────────── */}
      {previewModalImg && (
        <div
          role="dialog"
          aria-label="Image preview"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs select-none"
          onClick={() => setPreviewModalImg(null)}
        >
          <div className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-xl">
            <img src={previewModalImg} alt="Screenshot preview" className="max-h-[85vh] max-w-[90vw] object-contain" />
            <button
              type="button"
              onClick={() => setPreviewModalImg(null)}
              className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}