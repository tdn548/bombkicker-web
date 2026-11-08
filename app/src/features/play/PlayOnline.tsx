// Play Online (wireframe H, ux-spec 9.1): mode, quick match, create room, join room by code, rewards text.
import { useEffect, useId, useRef, useState } from "react";
import type { Mode } from "../../api/types";
import { useI18n } from "../../i18n/I18nProvider";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { Segmented } from "../../ui/Segmented";
import { isValidRoomCode, normalizeRoomCodeInput } from "../../unity/bridge";
import { usePlay } from "./PlayProvider";
import { usePlayGate } from "./usePlayGate";

const MODE_KEY = "bk_online_mode";

export function readOnlineMode(storage: Storage): Mode {
  return storage.getItem(MODE_KEY) === "2v2" ? "2v2" : "1v1";
}

export function PlayOnline() {
  const { t } = useI18n();
  const play = usePlay();
  const gate = usePlayGate();
  const [mode, setModeState] = useState<Mode>(() => readOnlineMode(localStorage));
  const [code, setCode] = useState("");
  const [badChar, setBadChar] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const badId = useId();
  const setMode = (m: Mode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  };

  // "Edit code" on ROOM_NOT_FOUND focuses the input with the code kept (ux-spec 9.3).
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("bk:edit-room-code", focus);
    return () => window.removeEventListener("bk:edit-room-code", focus);
  }, []);

  const onCode = (raw: string) => {
    const r = normalizeRoomCodeInput(raw);
    setCode(r.code);
    setBadChar(r.badChar);
  };
  const canJoin = isValidRoomCode(code);
  const join = () => {
    if (gate.off || !canJoin) return;
    play.startOnline({ kind: "joinRoom", roomCode: code });
  };

  return (
    <Page title={t("online.title")} className="play-online">
      <Segmented
        name="mode"
        label={t("online.mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "1v1", label: "1v1" },
          { value: "2v2", label: "2v2" },
        ]}
      />
      <p className="rewards">{t("online.rewards")}</p>
      <p className="note">{t("online.botsNote")}</p>
      <Button
        className="btn--big"
        off={gate.off}
        helper={gate.helper}
        onClick={() => play.startOnline({ kind: "quick", mode })}
        data-testid="quick-match"
      >
        {t("online.quick")}
      </Button>

      <section className="card" aria-labelledby={`${codeId}-h`}>
        <h2 id={`${codeId}-h`} className="card__title">
          {t("online.roomSection")}
        </h2>
        <Button variant="secondary" off={gate.off} onClick={() => play.startOnline({ kind: "createRoom", mode })} data-testid="create-room">
          {t("online.create")}
        </Button>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <label htmlFor={codeId} className="field__label">
            {t("online.codeLabel")}
          </label>
          <div className="join__row">
            <input
              ref={inputRef}
              id={codeId}
              className="code-input"
              value={code}
              onChange={(e) => onCode(e.target.value)}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={12}
              aria-describedby={badChar ? badId : undefined}
              aria-invalid={badChar || undefined}
              data-testid="room-code"
            />
            <Button variant="secondary" type="submit" off={gate.off || !canJoin} data-testid="join-room">
              {t("online.join")}
            </Button>
          </div>
          {badChar ? (
            <p id={badId} className="helper helper--warn" role="status">
              {t("online.codeBadChar")}
            </p>
          ) : null}
        </form>
      </section>
    </Page>
  );
}
