// Play Offline (wireframe I, ux-spec 5): mode, opponent (same-keyboard hidden on touch-only devices), map, start.
import { useEffect, useState } from "react";
import type { Mode } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { MAP_NAMES } from "../../i18n/params";
import type { MessageKey } from "../../i18n/vi";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { Segmented } from "../../ui/Segmented";
import type { OfflineMap, Opponent } from "../../unity/bridge";
import { usePlay, type OfflineSettings } from "./PlayProvider";
import { usePlayGate } from "./usePlayGate";

const OFFLINE_KEY = "bk_offline";
const DEFAULTS: OfflineSettings = { mode: "1v1", opponent: "bots", map: 1 };

function parseSaved(raw: string | null): Partial<OfflineSettings> {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    return typeof v === "object" && v !== null ? (v as Partial<OfflineSettings>) : {};
  } catch {
    return {};
  }
}

export function readOfflineSettings(storage: Storage, keyboard: boolean): OfflineSettings {
  const s = parseSaved(storage.getItem(OFFLINE_KEY));
  const mode: Mode = s.mode === "2v2" ? "2v2" : "1v1";
  // A saved "local" on a touch-only device falls back to bots (ux-spec 5).
  const opponent: Opponent = s.opponent === "local" && keyboard ? "local" : "bots";
  const map: OfflineMap = s.map === "random" || s.map === 1 || s.map === 2 || s.map === 3 || s.map === 4 ? s.map : DEFAULTS.map;
  return { mode, opponent, map };
}

/**
 * D16: hide "same-keyboard friend" when the primary pointer is coarse and there is no keyboard. Browsers cannot list
 * keyboards, so a fine pointer anywhere (mouse, trackpad) counts as "has a keyboard", and so does any key press seen
 * on this page (a tablet with a keyboard but no trackpad shows the option after the first key press).
 */
export function hasKeyboardLikeInput(mm: (q: string) => boolean, keySeen: boolean): boolean {
  if (keySeen) return true;
  if (mm("(any-pointer: fine)")) return true;
  return !mm("(pointer: coarse)");
}

const mm = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
let keySeenGlobal = false;

function useKeyboardInput(): boolean {
  const [keySeen, setKeySeen] = useState(keySeenGlobal);
  useEffect(() => {
    if (keySeen) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore virtual keyboards typing into a text field.
      if (e.target instanceof HTMLInputElement) return;
      keySeenGlobal = true;
      setKeySeen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keySeen]);
  return hasKeyboardLikeInput(mm, keySeen);
}

const MAPS: OfflineMap[] = [1, 2, 3, 4, "random"];

export function PlayOffline() {
  const { t } = useI18n();
  const play = usePlay();
  const gate = usePlayGate();
  const keyboard = useKeyboardInput();
  const [settings, setSettings] = useState<OfflineSettings>(() => readOfflineSettings(localStorage, keyboard));
  const opponent: Opponent = keyboard ? settings.opponent : "bots";
  const update = (patch: Partial<OfflineSettings>) => {
    const next = { ...settings, ...patch };
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(next));
    setSettings(next);
  };

  const keyRows: { slot: MessageKey; keys: MessageKey; in1v1: boolean }[] = [
    { slot: "offline.keys.p1", keys: "offline.keys.p1.keys", in1v1: true },
    { slot: "offline.keys.p2", keys: "offline.keys.p2.keys", in1v1: false },
    { slot: "offline.keys.p3", keys: "offline.keys.p3.keys", in1v1: false },
    { slot: "offline.keys.p4", keys: "offline.keys.p4.keys", in1v1: true },
  ];

  return (
    <Page title={t("offline.title")} className="play-offline">
      <Segmented
        name="mode"
        label={t("offline.mode")}
        value={settings.mode}
        onChange={(mode) => update({ mode })}
        options={[
          { value: "1v1", label: "1v1" },
          { value: "2v2", label: "2v2" },
        ]}
      />
      {keyboard ? (
        <Segmented
          name="opponent"
          label={t("offline.opponent")}
          value={opponent}
          onChange={(o) => update({ opponent: o })}
          options={[
            { value: "bots", label: t("offline.vsBots") },
            { value: "local", label: t("offline.local") },
          ]}
        />
      ) : null}
      {opponent === "local" ? (
        <section className="card keys" aria-labelledby="keys-title">
          <h2 id="keys-title" className="card__title">
            {t("offline.keysTitle")}
          </h2>
          <dl>
            {keyRows
              .filter((r) => settings.mode === "2v2" || r.in1v1)
              .map((r) => (
                <div key={r.slot} className="keys__row">
                  <dt>{t(r.slot)}</dt>
                  <dd>{t(r.keys)}</dd>
                </div>
              ))}
          </dl>
        </section>
      ) : null}
      <Segmented
        name="map"
        className="maps"
        label={t("offline.map")}
        value={settings.map}
        onChange={(map) => update({ map })}
        options={MAPS.map((m) => ({
          value: m,
          label: m === "random" ? t("offline.random") : MAP_NAMES[m],
          hint: t(m === "random" ? "offline.random.hint" : (`offline.map${m}.hint` as MessageKey)),
        }))}
      />
      <p className="note">{t("offline.noPoints")}</p>
      <Button
        className="btn--big"
        off={gate.off}
        helper={gate.helper}
        onClick={() => play.startOffline({ ...settings, opponent })}
        data-testid="start-offline"
      >
        {t("offline.start")}
      </Button>
    </Page>
  );
}
