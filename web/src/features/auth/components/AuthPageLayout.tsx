import { LocalizedText } from "../../../app/providers/LanguageProvider";
import type { ReactNode } from "react";
import garmentbizIcon from "../../../assets/garmentbiz-icon.svg";

interface AuthPageLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}

export default function AuthPageLayout({ title, description, children, footer }: AuthPageLayoutProps) {
  return (
    <main className="auth-route-state">
      <section className="auth-route-card" aria-labelledby="auth-page-title">
        <div className="auth-route-brand-mark" aria-hidden="true">
          <img src={garmentbizIcon} alt="" />
        </div>
        <p className="auth-route-eyebrow"><LocalizedText text={"GARMENTBIZ ETHIOPIA"} /></p>
        <h1 id="auth-page-title">{title}</h1>
        <p className="auth-route-message">{description}</p>
        {children}
        <div className="auth-route-footer">{footer}</div>
      </section>
    </main>
  );
}
