import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/api-client";
import { authSessionQueryKey } from "../auth/context/AuthProvider";
import { getUserLanguagePreference, updateUserLanguagePreference } from "../auth/api/auth.api";
import { useLanguage, LocalizedText, type Language } from "../../app/providers/LanguageProvider";
import "./settings.css";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const queryClient = useQueryClient();
  const previousLanguage = useRef<Language>(language);
  const [error, setError] = useState("");
  const preferenceQuery = useQuery({
    queryKey: ["auth", "language"],
    queryFn: getUserLanguagePreference,
    retry: false,
  });

  useEffect(() => {
    if (preferenceQuery.data?.language) {
      setLanguage(preferenceQuery.data.language);
      previousLanguage.current = preferenceQuery.data.language;
    }
  }, [preferenceQuery.data?.language, setLanguage]);

  const updateMutation = useMutation({
    mutationFn: updateUserLanguagePreference,
    onSuccess: ({ language: savedLanguage }) => {
      setLanguage(savedLanguage);
      previousLanguage.current = savedLanguage;
      setError("");
      queryClient.setQueryData(["auth", "language"], { language: savedLanguage });
      queryClient.setQueryData<{
        user: { id: string; fullName: string; email: string; language: Language };
        membership: { role: string; business: { id: string; name: string } };
      }>(authSessionQueryKey, (current) => current ? {
        ...current,
        user: { ...current.user, language: savedLanguage },
      } : current);
    },
    onError: (cause) => {
      setLanguage(previousLanguage.current);
      setError(cause instanceof ApiError ? t(cause.message) : t("Unable to save your language preference. Please try again."));
    },
  });

  function chooseLanguage(next: Language) {
    if (next === language || updateMutation.isPending) return;
    previousLanguage.current = language;
    setLanguage(next);
    setError("");
    updateMutation.mutate(next);
  }

  return (
    <div className="settings-page">
      <header className="page-heading">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("Manage your account preferences.")}</p>
        </div>
      </header>
      <section className="settings-preferences" aria-labelledby="personal-preferences-title">
        <h2 id="personal-preferences-title">{t("Personal Preferences")}</h2>
        <div className="settings-card" aria-labelledby="language-settings-title">
          <div>
            <h3 id="language-settings-title">{t("Language preference")}</h3>
            <p>{t("Choose the language used in GarmentBiz.")}</p>
          </div>
          <label htmlFor="settings-language">{t("Language")}</label>
          <select
            id="settings-language"
            value={language}
            disabled={preferenceQuery.isPending || updateMutation.isPending}
            onChange={(event) => chooseLanguage(event.target.value === "am" ? "am" : "en")}
          >
            <option value="en"><LocalizedText text={"English"} /></option>
            <option value="am">አማርኛ</option>
          </select>
          {preferenceQuery.isPending && <p role="status">{t("Loading…")}</p>}
          {updateMutation.isPending && <p role="status">{t("Saving…")}</p>}
          {preferenceQuery.isError && (
            <p className="settings-error" role="alert">
              {t("Unable to load your saved language preference.")}
              <button type="button" onClick={() => void preferenceQuery.refetch()}>{t("Retry")}</button>
            </p>
          )}
          {error && <p className="settings-error" role="alert">{error}</p>}
          {updateMutation.isSuccess && !error && !updateMutation.isPending && (
            <p className="settings-success" role="status" aria-live="polite">{t("Your language preference has been saved.")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
