// Confirm (D) and purchase errors (F), ux-spec 2.1, 2.2, 2.5. One PurchaseSession (one idempotencyKey) per mount:
// the shop mounts a new BuyDialog each time the player opens it, so only a new attempt after closing gets a new key.
import { useId, useRef, useState } from "react";
import type { SkinDto } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { Modal } from "../../ui/Modal";
import { PurchaseSession, type PurchaseApi, type PurchaseErrorView } from "./purchaseFlow";

type Phase = { phase: "confirm" } | { phase: "pending" } | { phase: "error"; view: PurchaseErrorView };

interface Props {
  /** The skin as it was when the dialog opened (its price is the expectedPrice). */
  skin: SkinDto;
  points: number;
  api: PurchaseApi;
  onClose(): void;
  onUnlocked(points: number | null): void;
  onEquip(): void;
  onRefetch(what: ("me" | "skins")[]): void;
  /** Tests: called with every attempt's idempotency key. */
  newKey?: () => string;
}

export function BuyDialog({ skin, points, api, onClose, onUnlocked, onEquip, onRefetch, newKey }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const bodyId = useId();
  const [session] = useState(() => new PurchaseSession(api, skin.key, newKey?.()));
  const [expectedPrice, setExpectedPrice] = useState(skin.price);
  const [state, setState] = useState<Phase>({ phase: "confirm" });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const pending = state.phase === "pending";
  const free = expectedPrice === 0;

  const attempt = async (price: number) => {
    setExpectedPrice(price);
    setState({ phase: "pending" });
    const out = await session.attempt(price, points);
    if (out.kind === "unlocked") {
      onUnlocked(out.points);
      return;
    }
    if (out.view.log) console.warn("[shop] purchase error", out.view.id, session.skinKey);
    if (out.view.refetch.length) onRefetch(out.view.refetch);
    setState({ phase: "error", view: out.view });
  };

  const stock =
    skin.stockLimit !== null ? <p data-testid="buy-stock">{t("buy.stock", { remaining: skin.remaining ?? 0, stockLimit: skin.stockLimit })}</p> : null;

  if (state.phase === "error") {
    const v = state.view;
    return (
      <Modal role="alertdialog" labelledBy={titleId} describedBy={bodyId} onClose={onClose} initialFocus={primaryRef} focusKey={v} testId="buy-dialog">
        <h2 id={titleId} className="dialog__title">
          {t("buy.errorTitle", { name: skin.name })}
        </h2>
        <p id={bodyId} data-testid="buy-error" data-error={v.id}>
          <span aria-hidden="true">⚠ </span>
          {t(v.message.key, v.message.params)}
        </p>
        <div className="dialog__buttons">
          {v.buttons.map((b, i) => {
            const ref = i === 0 ? primaryRef : undefined;
            const variant = i === 0 ? "btn--primary" : "btn--secondary";
            const common = { ref, type: "button" as const, className: `btn ${variant}`, "data-testid": `buy-err-${b}` };
            if (b === "retry") return <button key={b} {...common} onClick={() => void attempt(expectedPrice)}>{t("common.retry")}</button>;
            if (b === "buyAtPrice")
              return (
                <button key={b} {...common} onClick={() => void attempt(v.newPrice ?? expectedPrice)}>
                  {t("buy.atPrice", { price: v.newPrice ?? expectedPrice })}
                </button>
              );
            if (b === "equip") return <button key={b} {...common} onClick={() => { onEquip(); onClose(); }}>{t("shop.action.equip")}</button>;
            if (b === "cancel") return <button key={b} {...common} onClick={onClose}>{t("buy.cancel")}</button>;
            return <button key={b} {...common} onClick={onClose}>{t("common.close")}</button>;
          })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal labelledBy={titleId} describedBy={bodyId} onClose={onClose} locked={pending} initialFocus={cancelRef} testId="buy-dialog">
      <h2 id={titleId} className="dialog__title" data-testid="buy-title">
        {t(free ? "buy.free.title" : "buy.title", { name: skin.name })}
      </h2>
      <div id={bodyId} className="dialog__body">
        {free ? null : (
          <>
            <p data-testid="buy-price">{t("buy.price", { price: expectedPrice })}</p>
            <p data-testid="buy-balance">{t("buy.balance", { points, after: points - expectedPrice })}</p>
          </>
        )}
        {stock}
      </div>
      <div className="dialog__buttons">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn--secondary"
          aria-disabled={pending || undefined}
          onClick={() => !pending && onClose()}
          data-testid="buy-cancel"
        >
          {t("buy.cancel")}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          aria-disabled={pending || undefined}
          onClick={() => !pending && void attempt(expectedPrice)}
          data-testid="buy-confirm"
        >
          {pending ? (
            <>
              <span className="spinner spinner--inline" aria-hidden="true" />
              {t("buy.pending")}
            </>
          ) : (
            t(free ? "buy.free.confirm" : "buy.confirm")
          )}
        </button>
      </div>
    </Modal>
  );
}
