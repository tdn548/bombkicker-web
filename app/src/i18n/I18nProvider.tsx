// Language state (D13: Vietnamese first). Stored in localStorage "bk_lang", mirrored to <html lang>.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../unity/bridge";
import { en } from "./en";
import { vi, type MessageKey } from "./vi";

export const LANG_KEY = "bk_lang";
const TABLES: Record<Lang, Record<MessageKey, string>> = { vi, en };

export type Params = Record<string, string | number>;

/** Fill {placeholders}; numbers use the language's grouping (vi 1.000, en 1,000). Pure, exported for tests. */
export function format(lang: Lang, template: string, params?: Params): string {
  if (!params) return template;
  const nf = new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-US");
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === "number" ? nf.format(v) : v;
  });
}

export function readLang(storage: Storage): Lang {
  const v = storage.getItem(LANG_KEY);
  return v === "en" ? "en" : "vi";
}

interface I18n {
  lang: Lang;
  setLang(lang: Lang): void;
  t(key: MessageKey, params?: Params): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang(localStorage));
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, params) => format(lang, TABLES[lang][key], params) }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
