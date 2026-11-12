import { Link } from "react-router-dom";
import "../pages/AuthRouting.css";

interface AuthRoutePlaceholderProps {
  mode: "login" | "register";
}

export default function AuthRoutePlaceholder({ mode }: AuthRoutePlaceholderProps) {
  const isLogin = mode === "login";

  return (
    <main className="auth-route-state">
      <div className="auth-route-card">
        <div className="auth-route-brand-mark" aria-hidden="true">G</div>
        <p className="auth-route-eyebrow">GARMENTBIZ ETHIOPIA</p>
        <h1>{isLogin ? "Sign in" : "Create your account"}</h1>
        <p className="auth-route-message">
          {isLogin
            ? "The sign-in form will be added in the next authentication stage."
            : "The registration form will be added in the next authentication stage."}
        </p>
        <Link to={isLogin ? "/register" : "/login"}>
          {isLogin ? "Go to registration" : "Go to sign in"}
        </Link>
      </div>
    </main>
  );
}
