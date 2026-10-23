"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsClient } from "@/lib/hooks";
import { IconButton } from "./Button";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Take the whole screen on phones (script editor, recorder). */
  full?: boolean;
  /** Do not let a backdrop tap close it (uploads in progress). */
  locked?: boolean;
}

/**
 * Bottom sheet on phones, centred dialog from 640px up. Rendered through a
 * portal so it is never clipped by a scrolling card.
 */
export function Sheet({ open, onClose, title, description, children, footer, full = false, locked = false }: SheetProps) {
  const isClient = useIsClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Read through refs so the effect below runs once per open, not on every
  // parent render (an inline onClose would otherwise re-run it on each
  // keystroke and bounce focus back to the opener and then to the Close button).
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    onCloseRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panel)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lockedRef.current) onCloseRef.current();
      if (e.key === "Tab" && panel) {
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>(
            "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
          ),
        ).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!isClient || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={locked ? undefined : onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={[
          "relative flex w-full flex-col bg-surface text-fg shadow-2xl outline-none",
          full
            ? "h-[100dvh] sm:h-auto sm:max-h-[92dvh] sm:w-[560px] sm:rounded-2xl"
            : "max-h-[92dvh] rounded-t-2xl sm:w-[480px] sm:rounded-2xl",
        ].join(" ")}
      >
        <div className="flex items-start gap-3 px-4 pt-3 pb-2" style={{ paddingTop: full ? "calc(12px + var(--safe-top))" : undefined }}>
          {!full ? <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" aria-hidden /> : null}
          <div className="min-w-0 flex-1 pt-2">
            {title ? (
              <h2 id={titleId} className="text-xl font-bold leading-tight">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {!locked ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={22} />
            </IconButton>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-surface px-4 pt-3 safe-pb">{footer}</div>
        ) : (
          <div className="h-[var(--safe-bottom)]" />
        )}
      </div>
    </div>,
    document.body,
  );
}
