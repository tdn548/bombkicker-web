// Action button (wireframe C): the same component on the desktop detail panel and in the phone bottom sheet.
// Disabled states use aria-disabled (still focusable) and aria-describedby on the helper lines (ux-spec 1.2 rules).
import { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { ActionView } from "./shopLogic";

interface Props {
  view: ActionView;
  onBuy(): void;
  onEquip(): void;
}

export function ActionButton({ view, onBuy, onEquip }: Props) {
  const { t } = useI18n();
  const id = useId();
  if (view.kind === "skeleton") {
    return <div className="action-skeleton" aria-hidden="true" data-testid="action-skeleton" />;
  }
  const helperIds = view.helpers.map((_, i) => `${id}-h${i}`);
  return (
    <div className="action">
      <button
        type="button"
        className={`btn btn--big ${view.action === "buy" ? "btn--primary" : "btn--secondary"}`}
        aria-disabled={view.enabled ? undefined : true}
        aria-describedby={helperIds.length ? helperIds.join(" ") : undefined}
        data-testid="shop-action"
        data-row={view.row}
        data-kind={view.kind}
        onClick={(e) => {
          if (!view.enabled) {
            e.preventDefault();
            return;
          }
          if (view.action === "buy") onBuy();
          else if (view.action === "equip") onEquip();
        }}
      >
        {view.kind === "equipping" ? <span className="spinner spinner--inline" aria-hidden="true" /> : null}
        {view.label ? t(view.label.key, view.label.params) : null}
      </button>
      {view.helpers.map((h, i) => (
        <p key={h.key} id={helperIds[i]} className="helper" data-testid="shop-helper">
          {t(h.key, h.params)}
        </p>
      ))}
    </div>
  );
}
