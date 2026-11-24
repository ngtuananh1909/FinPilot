"use client";
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { FormAlert } from "./FormAlert";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY } from "./classes";
/**
 * Confirmation modal. The confirm button is disabled while `pending`, and the dialog cannot be
 * dismissed mid-request. `error` is announced in a live region inside the dialog.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = "Đang xử lý…",
  cancelLabel = "Hủy",
  tone = "danger",
  pending = false,
  error = null,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onCancel} dismissible={!pending} title={title} {...(description ? { description } : {})}>
      {children}
      <FormAlert message={error} />
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          disabled={pending || confirmDisabled}
          onClick={onConfirm}
          className={tone === "danger" ? BUTTON_DANGER : BUTTON_PRIMARY}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={BUTTON_SECONDARY}>
          {cancelLabel}
        </button>
      </div>
    </Dialog>
  );
}
