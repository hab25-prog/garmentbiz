import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../lib/api-client";
import AuthPageLayout from "../components/AuthPageLayout";
import { verifyEmail } from "../api/auth.api";
import { useLanguage, translateCurrent } from "../../../app/providers/LanguageProvider";

type VerificationState =
  | { status: "checking" }
  | { status: "verified" }
  | { status: "error"; message: string };

export default function VerifyEmailPage() {
  const { t } = useLanguage();
  const attempted = useRef(false);
  const tokenPresent = new URLSearchParams(window.location.hash.slice(1)).has("token");
  const [verification, setVerification] = useState<VerificationState>(() => tokenPresent
    ? { status: "checking" }
    : {
      status: "error",
      message: "This verification link is missing its token. Request a new verification email and open its link.",
    });

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    if (!token) return;

    void verifyEmail(token).then(
      () => setVerification({ status: "verified" }),
      (error: unknown) => setVerification({
        status: "error",
        message: error instanceof ApiError
          ? error.message
          : "We could not verify this email right now. Please try again later.",
      }),
    );
  }, []);

  const verified = verification.status === "verified";
  const checking = verification.status === "checking";
  const title = t(checking ? "Verifying your email" : verified ? "Email verified" : "Verification unsuccessful");
  const description = checking
    ? t("Please wait while we confirm your email address.")
    : verified
      ? t("Your email address is verified. You can now sign in.")
      : t("We could not confirm this verification link.");

  return (
    <AuthPageLayout title={title} description={description} footer={<>{t("Already registered?")} <Link to="/login">{t("Sign in")}</Link></>}>
      {checking ? (
        <p className="auth-verification-status" role="status" aria-live="polite">{t("Checking the verification link…")}</p>
      ) : verified ? (
        <div className="auth-registration-confirmation" role="status" aria-live="polite">
          <Link className="auth-registration-login-link" to="/login">{t("Continue to sign in")}</Link>
        </div>
      ) : (
        <div className="auth-form-error" role="alert">
          <p>{translateCurrent(t(verification.message))}</p>
          <Link to="/login">{t("Return to sign in")}</Link>
        </div>
      )}
    </AuthPageLayout>
  );
}
