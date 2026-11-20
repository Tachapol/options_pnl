"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { optimizeScreenshot } from "@/lib/image-compress";

type Item = {
  key: string; file: File; account: string; preview: string;
  state: string; id?: string; failed?: boolean; duplicate?: boolean; needsReview?: number;
};

type UploadCounts = { imported: number; duplicates: number; needs_review: number; unexecuted: number };
type RecentUpload = UploadCounts & { id: string; filename: string; extracted: boolean };

function formatUploadStatus(result: UploadCounts) {
  return [
    result.imported > 0 && `${result.imported} imported`,
    result.duplicates > 0 && `${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped`,
    result.needs_review > 0 && `${result.needs_review} to review`,
    result.unexecuted > 0 && `${result.unexecuted} unexecuted`,
  ].filter(Boolean).join(" · ") || "No trades imported";
}

function StateIcon({ failed, id, duplicate, needsReview }: Pick<Item, "failed" | "id" | "duplicate" | "needsReview">) {
  if (failed) return <span aria-hidden="true" className="text-base">⚠</span>;
  if (needsReview) return <span aria-hidden="true" className="text-base">!</span>;
  if (duplicate) return <span aria-hidden="true" className="text-base">↩</span>;
  if (id) return <span aria-hidden="true" className="text-base">✓</span>;
  return <span aria-hidden="true" className="text-base animate-pulse">…</span>;
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
  const previews = useRef<string[]>([]);
  const nextKey = useRef(0);

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
        update({ state: "Optimizing screenshot…", failed: false });
        fileToUpload = await optimizeScreenshot(item.file);
      }

      update({ state: "Reading screenshot…", failed: false });
      const form = new FormData();
      form.set("image", fileToUpload);
      if (item.account) {
        form.set("account", item.account);
      }
      const response = await fetch("/api/dime", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        update({ id: result.id, state: result.error || "Upload failed.", failed: true });
        return false;
      }
      const summary = formatUploadStatus(result);
      update({
        id: result.id,
        duplicate: result.duplicate,
        needsReview: result.needs_review,
        state: result.duplicate ? `Already uploaded · ${summary}` : summary,
      });
      return result.imported > 0;
    } catch (error) {
      update({ state: error instanceof Error ? error.message : "Upload failed.", failed: true });
      return false;
    }
  }

  async function queue(files: File[]) {
    if (!files.length) return;
    const isImage = (file: File) =>
      file.type.startsWith("image/") || /\.(?:png|jpe?g|webp|heic|heif)$/i.test(file.name);

    // Support up to 30 MB raw mobile camera/screenshot captures (client optimizer will downscale)
    const supported = files.filter((file) => isImage(file) && file.size > 0 && file.size <= 30 * 1024 * 1024);

    if (supported.length !== files.length) {
      setValidation("Please choose image files (PNG, JPEG, WebP, HEIC) up to 30 MB each.");
    } else {
      setValidation("");
    }

    const batch = supported.map((file): Item => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { key: String(nextKey.current++), file, preview, account, state: "Queued" };
    });
    setItems((rows) => [...rows, ...batch]);
    let imported = false;
    for (const image of batch) {
      if (await upload(image)) imported = true;
    }
    if (imported) onImported?.();
  }

  const earlierUploads = recent.filter((upload) => !items.some((item) => item.id === upload.id));

  return (
    <div className="grid gap-4">
      <div className="screenshot-dropbox relative overflow-hidden"
        data-dragging={dragging}
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
          type="file"
          accept="image/*"
          multiple
          aria-label="Upload Dime screenshots"
          className="absolute inset-0 z-10 block h-full w-full cursor-pointer opacity-0"
          onChange={(event) => {
            void queue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4m-5 5 5-5 5 5 M4 17v3h16v-3" />
        </svg>
        <strong className="text-base font-semibold">Upload Dime screenshots</strong>
        <span className="muted text-xs">Tap to choose photos or drag images here</span>
        <span aria-hidden="true" className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Choose photos / Camera
        </span>
      </div>
      <p className="muted text-xs">New fills import automatically. Unmatched trades are kept and paired when their other side is available.</p>
      {validation && <p role="alert" className="notice">{validation}</p>}
      {!!items.length && <ul className="divide-y divide-border">
        {items.map((item) => {
          const stateClass = item.failed ? "state-error" : item.needsReview ? "badge-needs-review" : item.id ? "state-success" : "state-pending";
          return (
            <li className="flex items-start gap-3 py-3" key={item.key}>
              <img src={item.preview} alt="" width={48} height={64} className="h-16 w-12 rounded border border-border object-cover flex-shrink-0" />
              <div className="min-w-0 flex-1 break-words text-sm">
                <strong>{item.file.name}</strong>
                <p role="status" className={`flex items-center gap-1.5 mt-0.5 text-sm ${stateClass}`}>
                  <StateIcon failed={item.failed} id={item.id} duplicate={item.duplicate} needsReview={item.needsReview} />
                  {item.state}
                </p>
                {item.id && <Link className="mt-1 inline-flex min-h-11 items-center text-link underline" href={`/imports/dime/${item.id}`}>
                  {item.needsReview || item.failed ? "Open review" : "View screenshot"}
                </Link>}
                {item.failed && <Button className="mt-2 min-h-11" variant="outline" onClick={async () => {
                  if (await upload(item)) onImported?.();
                }}>Retry image</Button>}
              </div>
            </li>
          );
        })}
      </ul>}
      {earlierUploads.length > 0 && (
        <section aria-label="Recent uploads" className="grid gap-2">
          <h3 className="text-sm font-semibold">Recent uploads</h3>
          <ul className="divide-y divide-border">
            {earlierUploads.map((upload) => (
              <li key={upload.id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
                <div className="min-w-0 break-words">
                  <strong>{upload.filename}</strong>
                  <p className="muted">{upload.extracted
                    ? formatUploadStatus(upload)
                    : "Screenshot saved. Select it again if processing was interrupted."}</p>
                </div>
                <Link className="inline-flex min-h-11 items-center text-link underline"
                  href={`/imports/dime/${upload.id}`} prefetch={false}>
                  {upload.needs_review ? "Open review" : "View screenshot"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
