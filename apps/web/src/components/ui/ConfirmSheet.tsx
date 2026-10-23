"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

/** A small yes/no sheet for actions worth a second look (delete, adopt a default). */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "primary",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      locked={busy}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant={tone} size="lg" full loading={busy} onClick={onConfirm} className="sm:flex-1">
            {confirmLabel}
          </Button>
          <Button variant="secondary" size="lg" full disabled={busy} onClick={onClose} className="sm:flex-1">
            Cancel
          </Button>
        </div>
      }
    >
      {body ? <div className="pt-1 text-base text-muted">{body}</div> : null}
    </Sheet>
  );
}
