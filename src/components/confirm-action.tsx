"use client";

import { useEffect, useId, useRef } from "react";

export function ConfirmAction({ open, title, description, label, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; label: string; busy: boolean; error?: string; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) { ref.current?.showModal(); ref.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus(); }
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  useEffect(() => { if (error && open) errorRef.current?.focus(); }, [error, open]);
  return <dialog className="confirm-dialog" ref={ref} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }}>
    <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p>
    {error ? <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p> : null}
    <div className="confirm-actions"><button type="button" className="secondary-button" data-cancel disabled={busy} onClick={onCancel}>取消</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : label}</button></div>
  </dialog>;
}
