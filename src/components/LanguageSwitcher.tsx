import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGS, type Lang } from "@/lib/i18n";

/** EN ⇄ FR toggle. A plain button — no dropdown — so it always responds. */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current: Lang = (SUPPORTED_LANGS as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : "en";
  const next: Lang = current === "en" ? "fr" : "en";

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1 font-mono text-xs"
      aria-label={t("lang.label")}
      title={`${t("lang.label")} → ${t(`lang.${next}`)}`}
      onClick={() => void i18n.changeLanguage(next)}
    >
      <Languages className="h-3 w-3" />
      {current.toUpperCase()}
    </Button>
  );
}
