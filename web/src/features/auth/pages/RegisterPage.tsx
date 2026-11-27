import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../lib/api-client";
import { useAuth } from "../context/AuthProvider";
import AuthPageLayout from "../components/AuthPageLayout";
import { useLanguage } from "../../../app/providers/LanguageProvider";
import { LanguageSelector } from "../../../app/components/LanguageSelector";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegistrationErrors {
  fullName?: string;
  email?: string;
  businessName?: string;
  password?: string;
  confirmPassword?: string;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const { language, t } = useLanguage();
  const submitting = useRef(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [submissionError, setSubmissionError] = useState("");
  const [registrationAccepted, setRegistrationAccepted] = useState(false);

  function validate(): RegistrationErrors {
    const normalizedEmail = email.trim();
    const nextErrors: RegistrationErrors = {};
    if (!fullName.trim()) nextErrors.fullName = "Enter your full name.";
    else if (fullName.trim().length > 120) nextErrors.fullName = "Full name must be 120 characters or fewer.";
    if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
      nextErrors.email = "Enter a valid email address (254 characters or fewer).";
    }
    if (!businessName.trim()) nextErrors.businessName = "Enter your business name.";
    else if (businessName.trim().length > 160) nextErrors.businessName = "Business name must be 160 characters or fewer.";
    if (password.length < 12 || password.length > 128) {
      nextErrors.password = "Password must be between 12 and 128 characters.";
    }
    if (confirmPassword !== password) nextErrors.confirmPassword = "Passwords do not match.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmissionError("");
    if (Object.keys(nextErrors).length > 0) return;

    submitting.current = true;
    setIsSubmitting(true);
    try {
      await register({
        fullName: fullName.trim(),
        email: email.trim(),
        businessName: businessName.trim(),
        password,
        language,
      });
      setRegistrationAccepted(true);
    } catch (error) {
      setSubmissionError(
        error instanceof ApiError ? error.message : "Unable to create your account right now. Please try again.",
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  function fieldError(field: keyof RegistrationErrors, id: string) {
    const message = errors[field];
    return message ? <span id={id} className="auth-field-error">{t(message)}</span> : null;
  }

  return (
    <AuthPageLayout
      title={t(registrationAccepted ? "Check your email" : "Create your account")}
      description={registrationAccepted
        ? t("Your registration request was accepted.")
        : t("Set up your workshop account to get started.")}
      footer={<>{t("Already registered?")} <Link to="/login">{t("Sign in")}</Link></>}
    >
      <LanguageSelector />
      {registrationAccepted ? (
        <div className="auth-registration-confirmation" role="status" aria-live="polite">
          <p>{t("If registration can be completed for that address, verification instructions may arrive by email.")}</p>
          <p>{t("Email delivery can be delayed or unsuccessful. Check your inbox and spam folder. You must verify your email before signing in.")}</p>
          <Link className="auth-registration-login-link" to="/login">{t("Return to sign in")}</Link>
        </div>
      ) : (
      <form className="auth-form auth-register-form" onSubmit={handleSubmit} noValidate>
        {submissionError && <div className="auth-form-error" role="alert">{t(submissionError)}</div>}

        <label className="auth-field" htmlFor="register-full-name">
          {t("Full name")}
          <input
            id="register-full-name"
            autoComplete="name"
            autoFocus
            required
            maxLength={120}
            value={fullName}
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? "register-full-name-error" : undefined}
            onChange={(event) => setFullName(event.target.value)}
            placeholder={t("Your full name")}
          />
          {fieldError("fullName", "register-full-name-error")}
        </label>

        <label className="auth-field" htmlFor="register-email">
          {t("Email address")}
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "register-email-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("you@example.com")}
          />
          {fieldError("email", "register-email-error")}
        </label>

        <label className="auth-field" htmlFor="register-business-name">
          {t("Business name")}
          <input
            id="register-business-name"
            autoComplete="organization"
            required
            maxLength={160}
            value={businessName}
            aria-invalid={Boolean(errors.businessName)}
            aria-describedby={errors.businessName ? "register-business-name-error" : undefined}
            onChange={(event) => setBusinessName(event.target.value)}
            placeholder={t("Your workshop or business")}
          />
          {fieldError("businessName", "register-business-name-error")}
        </label>

        <label className="auth-field" htmlFor="register-password">
          {t("Password")}
          <span className="auth-password-control">
            <input
              id="register-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "register-password-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("12–128 characters")}
            />
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={t(showPassword ? "Hide password" : "Show password")}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {fieldError("password", "register-password-error")}
        </label>

        <label className="auth-field" htmlFor="register-confirm-password">
          {t("Confirm password")}
          <span className="auth-password-control">
            <input
              id="register-confirm-password"
              type={showConfirmation ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={errors.confirmPassword ? "register-confirm-password-error" : undefined}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t("Enter the same password again")}
            />
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={t(showConfirmation ? "Hide confirmation" : "Show confirmation")}
              aria-pressed={showConfirmation}
              onClick={() => setShowConfirmation((visible) => !visible)}
            >
              {showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {fieldError("confirmPassword", "register-confirm-password-error")}
        </label>

        <button className="auth-submit-button" type="submit" disabled={isSubmitting}>
          {t(isSubmitting ? "Creating account…" : "Create account")}
        </button>
      </form>
      )}
    </AuthPageLayout>
  );
}
