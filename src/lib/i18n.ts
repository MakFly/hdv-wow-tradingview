/**
 * i18n setup — English is the default language.
 *
 * EN is the fallback and the language shown on first load. FR is available
 * and the user's explicit choice is persisted in localStorage ("lang").
 * Navigator language is intentionally NOT auto-detected so EN stays default.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

export const SUPPORTED_LANGS = ["en", "fr"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

/** Collapse an i18next language tag (e.g. "fr-FR") to a supported app language. */
export function normalizeLang(l?: string): Lang {
  return l?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      // localStorage only — no navigator detection, so EN is the default
      order: ["localStorage"],
      lookupLocalStorage: "lang",
      caches: ["localStorage"],
    },
  });

export default i18n;
