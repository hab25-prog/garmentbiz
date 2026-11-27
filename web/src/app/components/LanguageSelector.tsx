import { useLanguage, LocalizedText } from "../providers/LanguageProvider";

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label className="language-selector">
      <span>{t("Language")}</span>
      <select
        value={language}
        aria-label={t("Language")}
        onChange={(event) => setLanguage(event.target.value === "am" ? "am" : "en")}
      >
        <option value="en"><LocalizedText text={"English"} /></option>
        <option value="am">አማርኛ</option>
      </select>
    </label>
  );
}
