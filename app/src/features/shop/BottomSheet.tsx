// Phone bottom sheet (ux-spec 6.2): max 85% of the viewport, content scrolls, the action part is pinned to the bottom
// above the safe area. Closes with X, backdrop tap, a drag of the handle by more than 30% of the sheet height, Esc,
// or Back (the shop pushes a history entry when it opens the sheet). No slide animation with reduced motion (CSS).
import { useState, type ReactNode, type RefObject } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Modal } from "../../ui/Modal";

interface Props {
  labelledBy: string;
  initialFocus: RefObject<HTMLElement | null>;
  focusKey?: unknown;
  returnFocus(): HTMLElement | null;
  onClose(): void;
  header: (closeButton: ReactNode, handle: ReactNode) => ReactNode;
  body: ReactNode;
  footer: ReactNode;
}

export function BottomSheet({ labelledBy, initialFocus, focusKey, returnFocus, onClose, header, body, footer }: Props) {
  const { t } = useI18n();
  const [drag, setDrag] = useState<{ startY: number; dy: number; height: number } | null>(null);

  const handle = (
    <div
      className="sheet__handle"
      aria-hidden="true"
      data-testid="sheet-handle"
      onPointerDown={(e) => {
        const height = (e.currentTarget.closest("[data-modal]") as HTMLElement | null)?.offsetHeight ?? window.innerHeight;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ startY: e.clientY, dy: 0, height });
      }}
      onPointerMove={(e) => {
        if (drag) setDrag({ ...drag, dy: Math.max(0, e.clientY - drag.startY) });
      }}
      onPointerUp={() => {
        if (drag && drag.dy > drag.height * 0.3) onClose();
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <span className="sheet__grip" />
    </div>
  );
  const close = (
    <button type="button" className="btn btn--ghost sheet__close" onClick={onClose} aria-label={t("shop.closeDetail")} data-testid="sheet-close">
      <span aria-hidden="true">✕</span>
    </button>
  );
  return (
    <Modal
      labelledBy={labelledBy}
      onClose={onClose}
      initialFocus={initialFocus}
      focusKey={focusKey}
      returnFocus={returnFocus}
      className="sheet"
      backdropClassName="sheet-backdrop"
      testId="bottom-sheet"
      style={drag ? { transform: `translateY(${drag.dy}px)`, transition: "none" } : undefined}
    >
      {header(close, handle)}
      <div className="sheet__scroll">{body}</div>
      <div className="sheet__footer">{footer}</div>
    </Modal>
  );
}
