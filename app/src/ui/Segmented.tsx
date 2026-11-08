// Radio group drawn as toggle buttons (mode, opponent). Arrow keys move the selection, as a native radio group.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
}

interface Props<T extends string | number> {
  label: ReactNode;
  value: T;
  options: Option<T>[];
  onChange(value: T): void;
  className?: string;
  name?: string;
}

export function Segmented<T extends string | number>({ label, value, options, onChange, className, name }: Props<T>) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const d = keys[e.key];
    if (!d) return;
    e.preventDefault();
    const next = (i + d + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`field ${className ?? ""}`}>
      <div id={labelId} className="field__label">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="segmented" data-name={name}>
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={i === index ? 0 : -1}
            className={o.value === value ? "segmented__opt segmented__opt--on" : "segmented__opt"}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
          >
            <span className="segmented__label">{o.label}</span>
            {o.hint ? <span className="segmented__hint">{o.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
