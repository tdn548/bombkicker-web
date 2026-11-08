// Button that stays focusable when disabled (ux-spec 1.2 rule): aria-disabled + aria-describedby on the helper text,
// so a screen reader reads why it is off.
import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: "primary" | "secondary" | "ghost";
  off?: boolean;
  /** Shown under the button while off. */
  helper?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", off = false, helper, onClick, className, children, ref, ...rest }: Props) {
  const id = useId();
  return (
    <span className="btn-wrap">
      <button
        type="button"
        {...rest}
        ref={ref}
        className={`btn btn--${variant} ${className ?? ""}`}
        aria-disabled={off || undefined}
        aria-describedby={off && helper ? id : rest["aria-describedby"]}
        onClick={(e) => {
          if (off) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
      >
        {children}
      </button>
      {off && helper ? (
        <span id={id} className="helper">
          {helper}
        </span>
      ) : null}
    </span>
  );
}
