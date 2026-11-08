// Page frame for the sub-screens: back button and title.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18nProvider";

export function Page({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <main className={`page ${className ?? ""}`}>
      <header className="page__header">
        <Link to="/" className="btn btn--ghost page__back">
          <span aria-hidden="true">←</span> {t("nav.back")}
        </Link>
        <h1 className="page__title">{title}</h1>
      </header>
      <div className="page__body">{children}</div>
    </main>
  );
}
