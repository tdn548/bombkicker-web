// Skin card (wireframe B). The whole card is the tap target (ux-spec 6.3). Badges are text on a solid plate, never
// on the art (ux-spec 8.2), and stock is a plain number (ux-spec 7).
import type { Ref } from "react";
import type { SkinDto } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { SkinSprite } from "../../skins/SkinSprite";
import { cardBadges } from "./shopLogic";

interface Props {
  skin: SkinDto;
  owned: boolean;
  equipped: boolean;
  selected: boolean;
  onOpen(): void;
  ref?: Ref<HTMLButtonElement>;
}

export function SkinCard({ skin, owned, equipped, selected, onOpen, ref }: Props) {
  const { t } = useI18n();
  const badges = cardBadges(skin, owned, equipped);
  const locked = !owned && skin.onSale && !skin.soldOut;
  return (
    <li className="skin-grid__item">
      <button
        ref={ref}
        type="button"
        className={`skin-card ${selected ? "skin-card--selected" : ""}`}
        aria-pressed={selected}
        onClick={onOpen}
        data-testid={`skin-card-${skin.key}`}
        data-state={badges[0]?.kind ?? "none"}
      >
        <span className="skin-card__art">
          <SkinSprite skin={skin} anim="idle" scale={3} />
        </span>
        {/* Skin names are admin-written: always rendered as text (SEC-008 recheck). */}
        <span className="skin-card__name">{skin.name}</span>
        <span className="skin-card__rarity">{t(`rarity.${skin.rarity}`)}</span>
        <span className="skin-card__badges">
          {locked ? (
            <span className="badge badge--locked">
              <span aria-hidden="true">🔒</span> {t("shop.locked")}
            </span>
          ) : null}
          {badges.map((b) => (
            <span key={b.key} className={`badge badge--${b.kind}`} data-testid="skin-badge">
              {b.kind === "inUse" || b.kind === "owned" ? <span aria-hidden="true">✓ </span> : null}
              {t(b.key, b.params)}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
