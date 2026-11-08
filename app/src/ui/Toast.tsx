// One toast at a time (ux-spec 2.4): success as role="status", errors as role="alert". Hides after a few seconds.
import { useCallback, useEffect, useState } from "react";

export interface ToastMsg {
  text: string;
  tone: "status" | "alert";
  id: number;
}

export function useToast(ms = 5000) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const show = useCallback((text: string, tone: ToastMsg["tone"] = "status") => setToast({ text, tone, id: Date.now() + Math.random() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  return { toast, show };
}

export function ToastView({ toast }: { toast: ToastMsg | null }) {
  // The live regions stay mounted so screen readers announce new text.
  return (
    <div className="toasts">
      <div role="status" aria-live="polite">
        {toast?.tone === "status" ? (
          <p key={toast.id} className="toast" data-testid="toast">
            {toast.text}
          </p>
        ) : null}
      </div>
      <div role="alert">
        {toast?.tone === "alert" ? (
          <p key={toast.id} className="toast toast--alert" data-testid="toast-alert">
            <span aria-hidden="true">⚠ </span>
            {toast.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
