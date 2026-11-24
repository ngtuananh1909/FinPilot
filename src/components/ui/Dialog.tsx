"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Modal built on the native <dialog>: showModal() gives a focus trap, inert background, Esc to
 * close and focus return. Rendered only while `open`, so closed dialogs add nothing to the DOM.
 * Set `dismissible={false}` while an action is pending to keep the dialog from closing mid-request.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  dismissible = true,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  dismissible?: boolean;
  /** `lg` is for wide content such as tables; both sizes scroll when taller than the viewport. */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el || !open || el.open) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${size === "lg" ? "max-w-3xl" : "max-w-md"} overflow-y-auto rounded-sheet border border-outline-variant bg-surface-container-lowest p-6 text-on-surface shadow-lg`}
    >
      <h2 id={titleId} className="text-title-lg text-on-surface">
        {title}
      </h2>
      {description ? (
        <p id={descId} className="mt-1 text-body-md text-on-surface-variant">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
