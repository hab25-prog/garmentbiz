import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../lib/api-client";
import AuthPageLayout from "../../auth/components/AuthPageLayout";
import { acceptEmployeeInvitation } from "../api/employee-invitations.api";
import { requestVerificationEmail } from "../../auth/api/auth.api";
import { useLanguage, translateCurrent } from "../../../app/providers/LanguageProvider";
import "./accept-invitation.css";

type PageState = "form" | "submitting" | "accepted" | "missing" | "unavailable" | "uncertain";

export default function AcceptInvitationPage() {
  const { t } = useLanguage();
  const attempt = useRef(false);
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const [password, setPassword] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendError, setResendError] = useState("");
  const [pageState, setPageState] = useState<PageState>(token ? "form" : "missing");
  const [error, setError] = useState("");

  useEffect(() => {
    // The fragment is a bearer credential. Remove it from browser history before rendering further.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempt.current || !token) return;
    if (password.length < 12 || password.length > 128) {
      setError("Password must be between 12 and 128 characters");
      return;
    }

    attempt.current = true;
    setError("");
    setPageState("submitting");
    try {
      await acceptEmployeeInvitation({ token, password });
      setPassword("");
      setPageState("accepted");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to accept this invitation right now");
      if (!(cause instanceof ApiError) || cause.status === 0 || cause.status >= 500) {
        // Acceptance may have committed even though the response was lost. Never prompt an automatic retry.
        setPageState("uncertain");
      } else if ([400, 409, 410].includes(cause.status)) {
        setPageState("unavailable");
      } else {
        setPageState("form");
        attempt.current = false;
      }
    }
  }

  async function handleResendVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resending) return;
    const normalizedEmail = verificationEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      setResendError("Enter a valid email address.");
      setResendMessage("");
      return;
    }
    setResending(true);
    setResendError("");
    setResendMessage("");
    try {
      const result = await requestVerificationEmail(normalizedEmail);
      setResendMessage(result.message);
    } catch (cause) {
      setResendError(cause instanceof ApiError ? cause.message : "We could not process the request right now. Please try again later.");
    } finally {
      setResending(false);
    }
  }

  const accepted = pageState === "accepted";
  const submitting = pageState === "submitting";
  const title = accepted
    ? t("Invitation accepted")
    : pageState === "unavailable"
      ? t("Invitation cannot be accepted")
      : pageState === "uncertain"
        ? t("Invitation result is not confirmed")
    : pageState === "missing"
      ? t("Invitation link unavailable")
      : t("Accept employee invitation");
  const description = accepted
    ? t("Your invitation is accepted. Sign in with this account. If the account is new or unverified, verify its email before signing in.")
    : pageState === "unavailable"
      ? t("The invitation may be expired, revoked, already used, or no longer match the employee profile.")
      : pageState === "uncertain"
        ? t("We could not confirm the result. Check your email for verification instructions and try signing in. If the invitation was not accepted, reopen the original invitation email link.")
        : t("Use your GarmentBiz account password, or choose a password if you are new.");

  return (
    <AuthPageLayout
      title={title}
      description={description}
      footer={<>{t("Already have an account?")} <Link to="/login">{t("Sign in")}</Link></>}
    >
      {accepted ? (
        <div className="auth-registration-confirmation">
          <p role="status" aria-live="polite">{t("Verification instructions may be sent for new or unverified accounts. Email delivery is not guaranteed.")}</p>
          <form className="auth-form" onSubmit={handleResendVerification} noValidate>
            <label className="auth-field" htmlFor="invitation-verification-email">
              {t("Email address")}
              <input
                id="invitation-verification-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={verificationEmail}
                aria-invalid={Boolean(resendError)}
                onChange={(event) => {
                  setVerificationEmail(event.target.value);
                  if (resendError) setResendError("");
                }}
              />
            </label>
            {resendError && <div className="auth-form-error" role="alert">{translateCurrent(t(resendError))}</div>}
            {resendMessage && <p role="status" aria-live="polite">{translateCurrent(t(resendMessage))}</p>}
            <button className="auth-submit-button" type="submit" disabled={resending}>
              {resending ? t("Sending…") : t("Resend verification email")}
            </button>
          </form>
          <Link className="auth-registration-login-link" to="/login">{t("Continue to sign in")}</Link>
        </div>
      ) : pageState === "missing" ? (
        <div className="auth-form-error" role="alert">
          <p>{t("This invitation link is missing its token. Open the full invitation link from your email.")}</p>
          <Link to="/login">{t("Return to sign in")}</Link>
        </div>
      ) : pageState === "unavailable" || pageState === "uncertain" ? (
        <div className="auth-form-error" role="alert">
          <p>{translateCurrent(t(error))}</p>
          <Link to="/login">{t("Return to sign in")}</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <p className="invitation-password-hint">
            {t("Enter the password for your account, or create one if you do not have an account yet.")}
          </p>
          {error && <div className="auth-form-error" role="alert">{translateCurrent(t(error))}</div>}
          <label className="auth-field" htmlFor="invitation-password">
            {t("Password for your GarmentBiz account")}
            <input
              id="invitation-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError("");
              }}
            />
          </label>
          <button className="auth-submit-button" type="submit" disabled={submitting}>
            {submitting ? t("Accepting invitation…") : t("Accept invitation")}
          </button>
        </form>
      )}
    </AuthPageLayout>
  );
}
