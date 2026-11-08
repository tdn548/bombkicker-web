// Unlocked (E), ux-spec 2.3: shown on 201 and on a 200 replay. Idle animation with the team ring, no flashing.
import { useId, useRef } from "react";
import type { SkinDto } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { SkinSprite } from "../../skins/SkinSprite";
import { Modal } from "../../ui/Modal";

interface Props {
  skin: SkinDto;
  points: number | null;
  onEquip(): void;
  onClose(): void;
}

export function UnlockedDialog({ skin, points, onEquip, onClose }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const equipRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal labelledBy={titleId} onClose={onClose} initialFocus={equipRef} testId="unlocked-dialog" className="dialog dialog--unlocked">
      <h2 id={titleId} className="dialog__title">
        {t("unlocked.title", { name: skin.name })}
      </h2>
      <div className="unlocked__art">
        <SkinSprite skin={skin} anim="idle" scale={5} ring={1} label={skin.name} />
      </div>
      {points !== null ? <p data-testid="unlocked-balance">{t("unlocked.balance", { points })}</p> : null}
      <div className="dialog__buttons">
        <button ref={equipRef} type="button" className="btn btn--primary" onClick={onEquip} data-testid="unlocked-equip">
          {t("unlocked.equip")}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose} data-testid="unlocked-later">
          {t("unlocked.later")}
        </button>
      </div>
    </Modal>
  );
}
