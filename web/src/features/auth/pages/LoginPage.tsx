import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../lib/api-client";
import { useAuth } from "../context/AuthProvider";
import AuthPageLayout from "../components/AuthPageLayout";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { login } = useAuth();
  const submitting = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [submissionError, setSubmissionError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const normalizedEmail = email.trim();
    const nextEmailError = !EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254
      ? "Enter a valid email address."
      : "";
    const nextPasswordError = password.length < 12 || password.length > 128
      ? "Password must be between 12 and 128 characters."
      : "";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setSubmissionError("");
    if (nextEmailError || nextPasswordError) return;

    submitting.current = true;
    setIsSubmitting(true);
    try {
      await login({ email: normalizedEmail, password });
    } catch (error) {
      setSubmissionError(
        error instanceof ApiError ? error.message : "Unable to sign in right now. Please try again.",
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Welcome back"
      description="Sign in to manage your garment workshop."
      footer={<>New to GarmentBiz? <Link to="/register">Create an account</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {submissionError && <div className="auth-form-error" role="alert">{submissionError}</div>}

        <label className="auth-field" htmlFor="login-email">
          Email address
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            maxLength={254}
            value={email}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "login-email-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError("");
            }}
            placeholder="you@example.com"
          />
          {emailError && <span id="login-email-error" className="auth-field-error">{emailError}</span>}
        </label>

        <label className="auth-field" htmlFor="login-password">
          Password
          <span className="auth-password-control">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "login-password-error" : undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordError) setPasswordError("");
              }}
              placeholder="Enter your password"
            />
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {passwordError && <span id="login-password-error" className="auth-field-error">{passwordError}</span>}
        </label>

        <button className="auth-submit-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthPageLayout>
  );
}
