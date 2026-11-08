// Skin detail (wireframe B/C): preview tabs idle / walk / swing / death with the team ring, facts, action button.
// Rendered in the desktop side panel and in the phone bottom sheet; the sheet pins the action part to its bottom.
import { useState, type ReactNode, type Ref } from "react";
import type { SkinDto } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { SKIN_ANIMS, type SkinAnim } from "../../skins/layout";
import { SkinSprite } from "../../skins/SkinSprite";
import { Segmented } from "../../ui/Segmented";
import { ActionButton } from "./ActionButton";
import type { ActionView } from "./shopLogic";

interface Props {
  skin: SkinDto;
  view: ActionView;
  headingId: string;
  headingRef?: Ref<HTMLHeadingElement>;
  onBuy(): void;
  onEquip(): void;
  /** Phone sheet: the close button and the drag handle live in the header. */
  headerExtra?: ReactNode;
}

export function DetailHeader({ skin, headingId, headingRef, extra }: { skin: SkinDto; headingId: string; headingRef?: Ref<HTMLHeadingElement>; extra?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="detail__header">
      <div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="detail__title" data-testid="detail-title">
          {skin.name}
        </h2>
        <p className="detail__rarity">{t(`rarity.${skin.rarity}`)}</p>
      </div>
      {extra}
    </header>
  );
}

export function SkinPreview({ skin }: { skin: SkinDto }) {
  const { t } = useI18n();
  const [anim, setAnim] = useState<SkinAnim>("idle");
  const [team, setTeam] = useState<1 | 2>(1);
  // Integer zoom so the pixel art stays sharp; the 96 px swing row gets a smaller zoom so it fits a 360 px phone.
  const scale = anim === "swing" ? 3 : 5;
  return (
    <div className="detail__preview">
      <div className="preview-stage" data-testid="preview-stage" data-anim={anim} data-team={team}>
        <SkinSprite
          key={`${skin.key}-${anim}`}
          skin={skin}
          anim={anim}
          scale={scale}
          // Unity hides the ring while the death object is active (SS-10), so the preview does too
          ring={anim === "death" ? null : team}
          label={t("shop.preview", { name: skin.name, anim: t(`shop.anim.${anim}`) })}
        />
      </div>
      <Segmented<SkinAnim>
        name="anim"
        className="preview-tabs"
        label={t("shop.anim")}
        value={anim}
        onChange={setAnim}
        options={SKIN_ANIMS.map((a) => ({ value: a, label: t(`shop.anim.${a}`) }))}
      />
      <Segmented<1 | 2>
        name="team"
        className="preview-tabs"
        label={t("shop.ringTeam")}
        value={team}
        onChange={setTeam}
        options={[
          { value: 1, label: t("team.1") },
          { value: 2, label: t("team.2") },
        ]}
      />
      <p className="note">{t("shop.ringNote")}</p>
    </div>
  );
}

export function DetailFacts({ skin }: { skin: SkinDto }) {
  const { t } = useI18n();
  return (
    <div className="detail__facts">
      {skin.stockLimit !== null ? <p data-testid="detail-limited">{t("shop.limited", { stockLimit: skin.stockLimit })}</p> : null}
      <p className="note">{t("shop.equip.offlineNote")}</p>
    </div>
  );
}

/** Desktop panel: everything in one column. */
export function SkinDetail({ skin, view, headingId, headingRef, onBuy, onEquip, headerExtra }: Props) {
  return (
    <div className="detail" data-testid="skin-detail" data-skin={skin.key}>
      <DetailHeader skin={skin} headingId={headingId} headingRef={headingRef} extra={headerExtra} />
      <SkinPreview key={skin.key} skin={skin} />
      <DetailFacts skin={skin} />
      <ActionButton view={view} onBuy={onBuy} onEquip={onEquip} />
    </div>
  );
}
