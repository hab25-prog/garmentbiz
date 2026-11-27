import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { Link } from "react-router-dom";
import garmentbizIcon from "../../../assets/garmentbiz-icon.svg";
import "../pages/AuthRouting.css";

interface AuthRoutePlaceholderProps {
  mode: "login" | "register";
}

export default function AuthRoutePlaceholder({ mode }: AuthRoutePlaceholderProps) {
  const isLogin = mode === "login";

  return (
    <main className="auth-route-state">
      <div className="auth-route-card">
        <div className="auth-route-brand-mark" aria-hidden="true">
          <img src={garmentbizIcon} alt="" />
        </div>
        <p className="auth-route-eyebrow"><LocalizedText text={"GARMENTBIZ ETHIOPIA"} /></p>
        <h1>{translateCurrent(isLogin ? "Sign in" : "Create your account")}</h1>
        <p className="auth-route-message">
          {translateCurrent(isLogin
            ? "The sign-in form will be added in the next authentication stage."
            : "The registration form will be added in the next authentication stage.")}
        </p>
        <Link to={isLogin ? "/register" : "/login"}>
          {translateCurrent(isLogin ? "Go to registration" : "Go to sign in")}
        </Link>
      </div>
    </main>
  );
}
