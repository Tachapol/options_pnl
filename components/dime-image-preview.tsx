"use client";

import { useEffect, useRef, useState } from "react";

export function DimeImagePreview({ src, alt = "Original Dime screenshot" }: { src: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handleOpen() {
    resetZoom();
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    resetZoom();
  }

  // Keyboard navigation: Escape to close, + / - to zoom
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.5, 4));
      else if (e.key === "-") setZoom((z) => Math.max(z - 0.5, 1));
      else if (e.key === "0") resetZoom();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Lock body scroll while lightbox is active
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Mouse drag handlers for panning when zoomed
  function onMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!isDragging.current || zoom <= 1) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
  }

  function onMouseUp() {
    isDragging.current = false;
  }

  return (
    <>
      <div className="group relative">
        <button
          type="button"
          onClick={handleOpen}
          className="relative block w-full overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary cursor-zoom-in text-left"
          aria-label="Click to inspect and zoom screenshot"
        >
          <img
            src={src}
            alt={alt}
            className="mx-auto max-h-56 w-auto max-w-full rounded object-contain transition-transform duration-200 group-hover:scale-[1.02] lg:max-h-[70vh]"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent py-2.5 text-xs font-medium text-white opacity-95 transition-opacity group-hover:opacity-100">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <span>Tap to inspect / Zoom</span>
          </div>
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot lightbox inspector"
          className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md animate-in fade-in duration-150 select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          {/* Top control bar */}
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/70">Screenshot Viewer</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/90">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 0.5, 1))}
                disabled={zoom <= 1}
                aria-label="Zoom out"
                className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10 text-sm font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                −
              </button>
              <button
                type="button"
                onClick={resetZoom}
                disabled={zoom === 1}
                aria-label="Reset zoom"
                className="rounded-md border border-white/20 bg-white/10 px-2.5 h-8 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                1x
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 0.5, 4))}
                disabled={zoom >= 4}
                aria-label="Zoom in"
                className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10 text-sm font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                +
              </button>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2.5 h-8 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                Open original ↗
              </a>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close inspector"
                className="grid h-8 w-8 place-items-center rounded-md border border-white/20 bg-white/10 text-base font-bold text-white transition-colors hover:bg-red-500/80 cursor-pointer ml-1"
              >
                ✕
              </button>
            </div>
          </header>

          {/* Image viewport with zoom and pan */}
          <div
            className={`relative flex flex-1 items-center justify-center overflow-hidden p-2 sm:p-4 ${
              zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
            }`}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <img
              src={src}
              alt={alt}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isDragging.current ? "none" : "transform 150ms ease-out",
                maxHeight: "calc(100vh - 5.5rem)",
                maxWidth: "100%",
                objectFit: "contain",
              }}
              className="rounded pointer-events-none"
              draggable={false}
            />
          </div>

          <footer className="border-t border-white/10 py-2 text-center text-xs text-white/50">
            {zoom > 1 ? "Drag to pan image · Use +/- or 0 to reset" : "Click + or pinch to zoom in · Esc to close"}
          </footer>
        </div>
      )}
    </>
  );
}
