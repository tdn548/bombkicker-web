// Searching overlay (ux-spec 9.2 states, 9.3 errors): shown from startOnline until inMatch, over every screen.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/vi";
import { Button } from "../../ui/Button";
import { overlayView, type OnlineErrorAction, type OnlineState } from "./onlineFlow";
import { usePlay } from "./PlayProvider";

/** Local 1 s countdown between status messages; re-syncs whenever a new status arrives. */
function useCountdown(seconds: number | undefined, sync: unknown): number | undefined {
  const [left, setLeft] = useState(seconds);
  const [synced, setSynced] = useState<unknown>(sync);
  if (synced !== sync) {
    setSynced(sync);
    setLeft(seconds);
  }
  useEffect(() => {
    if (seconds === undefined) return;
    const t = setInterval(() => setLeft((s) => (s === undefined ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [seconds, sync]);
  return left;
}

export function SearchingOverlay() {
  const play = usePlay();
  if (play.stage.stage !== "online") return null;
  const phase = play.stage.online.status?.phase;
  if (phase === "inMatch" && !play.stage.online.error) return null;
  return <OverlayBody online={play.stage.online} />;
}

function OverlayBody({ online }: { online: OnlineState }) {
  const { t } = useI18n();
  const play = usePlay();
  const navigate = useNavigate();
  const view = overlayView(online);
  const status = online.status;
  const seconds = useCountdown(status?.seconds, status);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const error = online.error;

  useEffect(() => {
    (error ? actionRef.current : titleRef.current)?.focus();
  }, [error]);
  // BUG-SS18-003, ux-spec 8.3 "Esc closes sheets and dialogs": Esc on an error closes it like Close / Đóng
  // (back to the idle Play Online screen, 9.3). The searching states keep their explicit Cancel button.
  const { dismissError } = play;
  useEffect(() => {
    if (!error) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismissError();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [error, dismissError]);

  const params = {
    roomCode: online.roomCode ?? "",
    mode: online.mode ?? status?.mode ?? "",
    humans: status?.humans ?? 1,
    capacity: status?.capacity ?? (online.mode === "2v2" ? 4 : 2),
    seconds: seconds ?? 0,
  };

  const copy = async () => {
    const code = online.roomCode ?? "";
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: select the code so the player can copy it by hand.
      const el = codeRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  if (error) {
    const label: Record<OnlineErrorAction, MessageKey> = {
      retry: "common.retry",
      playOffline: "online.playOffline",
      close: "common.close",
      editCode: "online.editCode",
      reload: "common.reload",
    };
    const run = (a: OnlineErrorAction) => {
      if (a === "retry") play.retryOnline();
      else if (a === "reload") location.reload();
      else {
        play.dismissError();
        if (a === "playOffline") navigate("/play/offline");
        if (a === "editCode") {
          navigate("/play/online");
          setTimeout(() => window.dispatchEvent(new Event("bk:edit-room-code")), 0);
        }
      }
    };
    return (
      <div className="overlay" data-testid="searching-overlay">
        <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="online-error-text">
          <p id="online-error-text" className="dialog__text" data-testid="online-error" data-code={error.code}>
            {t(error.key, params)}
          </p>
          <div className="dialog__buttons">
            {error.actions.map((a, i) => (
              <Button key={a} variant={i === 0 ? "primary" : "secondary"} ref={i === 0 ? actionRef : undefined} onClick={() => run(a)}>
                {t(label[a])}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const cancelLabel: MessageKey = view.buttons.includes("leaveRoom") ? "online.leaveRoom" : "online.cancel";
  return (
    <div className="overlay" data-testid="searching-overlay" data-phase={status?.phase ?? "pending"}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="online-title">
        <h2 id="online-title" ref={titleRef} tabIndex={-1} className="dialog__title" aria-live="polite">
          {t(view.title, params)}
        </h2>
        {view.body ? (
          <p className="dialog__text" aria-live="polite">
            {renderWithCode(t(view.body, params), online.roomCode, codeRef)}
          </p>
        ) : null}
        {view.codeLine && online.roomCode ? <p className="dialog__text">{renderWithCode(t("online.roomCodeLine", params), online.roomCode, codeRef)}</p> : null}
        {view.title !== "online.loading" ? <div className="spinner" aria-hidden="true" /> : null}
        <div className="dialog__buttons">
          {view.buttons.includes("copy") ? (
            <Button variant="secondary" onClick={copy} data-testid="copy-code">
              {t("online.copy")}
            </Button>
          ) : null}
          {view.buttons.includes("cancel") || view.buttons.includes("leaveRoom") ? (
            <Button variant="ghost" onClick={play.cancelOnline} data-testid="cancel-online">
              {t(cancelLabel)}
            </Button>
          ) : null}
        </div>
        {view.cancelNote && view.buttons.length > 0 ? <p className="helper">{t("online.cancelNote")}</p> : null}
        {copied ? (
          <p className="toast" role="status">
            {t("online.copied")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Bold monospace room code inside a sentence (shown as one group of 6, as typed). */
function renderWithCode(text: string, code: string | null, ref: React.RefObject<HTMLElement | null>) {
  if (!code || !text.includes(code)) return text;
  const [before, ...rest] = text.split(code);
  return (
    <>
      {before}
      <strong className="room-code" ref={ref} data-testid="room-code-display">
        {code}
      </strong>
      {rest.join(code)}
    </>
  );
}
