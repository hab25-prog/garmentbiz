import { isLanguage, LANGUAGE_STORAGE_KEY } from "../providers/LanguageProvider";

export function getAppDateLocale(): string {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(storedLanguage) && storedLanguage === "am") {
      return Intl.DateTimeFormat.supportedLocalesOf(["am-ET"]).length > 0 ? "am-ET" : "am";
    }
  } catch {
    // Continue with the English default when browser storage is unavailable.
  }
  return "en-ET";
}

export function formatAppDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(getAppDateLocale(), options).format(date);
}
