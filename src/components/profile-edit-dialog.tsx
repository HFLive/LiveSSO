"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function ProfileEditDialog({
  open,
  title,
  description,
  busy = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-profile-dialog-focus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return <dialog
    ref={dialogRef}
    className="profile-edit-dialog"
    aria-labelledby={titleId}
    onCancel={(event) => {
      if (busy) event.preventDefault();
      else onClose();
    }}
  >
    <div className="profile-dialog-header">
      <div>
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <button className="profile-dialog-close" type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
    </div>
    {children}
  </dialog>;
}
