// Profile (minimal for SS-13: name, W/L, language switch -> setLang). SS-14 adds the name change and owned count.
import { useI18n } from "../../i18n/I18nProvider";
import { usePlayerData } from "../../state/PlayerData";
import { Page } from "../../ui/Page";
import { Segmented } from "../../ui/Segmented";

export function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const { me } = usePlayerData();
  return (
    <Page title={t("profile.title")}>
      {me ? (
        <section className="card">
          <h2 className="card__title" data-testid="profile-name">
            {me.displayName}
          </h2>
          <p>{t("menu.points", { points: me.points })}</p>
          <p>{t("profile.stats", { wins: me.stats.wins, losses: me.stats.losses, draws: me.stats.draws })}</p>
        </section>
      ) : (
        <p>{t("menu.loadingAccount")}</p>
      )}
      <Segmented
        name="lang"
        label={t("profile.language")}
        value={lang}
        onChange={setLang}
        options={[
          { value: "vi", label: t("profile.lang.vi") },
          { value: "en", label: t("profile.lang.en") },
        ]}
      />
    </Page>
  );
}
