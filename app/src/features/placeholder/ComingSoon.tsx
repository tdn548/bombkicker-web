// Shop (B-F) and Leaderboard (G) are SS-14; these routes keep the menu links working until then.
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/vi";
import { Page } from "../../ui/Page";

export function ComingSoon({ title, body }: { title: MessageKey; body: MessageKey }) {
  const { t } = useI18n();
  return (
    <Page title={t(title)}>
      <p>{t(body)}</p>
    </Page>
  );
}
