// Whether a Play button may start a match now, and the helper text when it may not (ux-spec 6.4).
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { useUnity } from "../../unity/UnityHost";
import { usePlay } from "./PlayProvider";

export function usePlayGate(): { off: boolean; helper: string | undefined } {
  const { t } = useI18n();
  const { boot } = useUnity();
  const { status } = useAuth();
  const { canStart } = usePlay();
  if (boot.state === "failed") return { off: true, helper: undefined };
  if (boot.state !== "ready") return { off: true, helper: t("menu.waitGame") };
  if (status !== "ready") return { off: true, helper: t("menu.loadingAccount") };
  if (!canStart) return { off: true, helper: t("menu.busy") };
  return { off: false, helper: undefined };
}
