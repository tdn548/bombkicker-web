// Modal layer for dialogs D-F and the phone bottom sheet (ux-spec 2, 6.2, 8.3): role dialog/alertdialog, aria-modal,
// focus moves in on open, Tab is trapped, Esc and backdrop close unless `locked` (a purchase in flight), focus goes
// back to the element that had it when the modal closes.
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

interface Props {
  role?: "dialog" | "alertdialog";
  labelledBy: string;
  describedBy?: string;
  onClose(): void;
  /** While true, Esc and backdrop clicks do nothing. */
  locked?: boolean;
  /** Element to focus on open (and again whenever `focusKey` changes). */
  initialFocus: RefObject<HTMLElement | null>;
  focusKey?: unknown;
  /** Where focus goes on close; defaults to the element focused before the modal opened. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
  backdropClassName?: string;
  testId?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Modal({
  role = "dialog",
  labelledBy,
  describedBy,
  onClose,
  locked = false,
  initialFocus,
  focusKey,
  returnFocus,
  className,
  backdropClassName,
  testId,
  style,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const returnRef = useRef(returnFocus);
  const lockedRef = useRef(locked);
  const closeRef = useRef(onClose);
  useEffect(() => {
    returnRef.current = returnFocus;
    lockedRef.current = locked;
    closeRef.current = onClose;
  });

  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const target = returnRef.current?.() ?? (opener.current instanceof HTMLElement ? opener.current : null);
      // after the DOM update, so the target is focusable again (no longer under an inert or hidden layer)
      setTimeout(() => target?.focus?.(), 0);
    };
  }, []);

  useEffect(() => {
    initialFocus.current?.focus();
  }, [initialFocus, focusKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ref.current) return;
      // only the top-most modal reacts (a buy dialog over the bottom sheet)
      const all = document.querySelectorAll("[data-modal]");
      if (all[all.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!lockedRef.current) closeRef.current();
        return;
      }
      trapTab(e, ref.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={backdropClassName ?? "overlay"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={ref}
        data-modal=""
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={className ?? "dialog"}
        data-testid={testId}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
