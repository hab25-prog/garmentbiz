import { translateCurrent } from "../../../app/providers/LanguageProvider";
import "../pages/AuthRouting.css";

export default function Loader() {
  return (
    <main className="auth-route-state">
      <div className="auth-loader" role="status" aria-label={translateCurrent("Loading")}>
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
