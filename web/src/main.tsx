import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { QueryProvider } from "./app/providers/QueryProvider";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./features/auth/context/AuthProvider";
import { ToastProvider } from "./app/providers/ToastProvider";
import { LanguageProvider } from "./app/providers/LanguageProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <ToastProvider>
        <QueryProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryProvider>
      </ToastProvider>
    </LanguageProvider>
  </StrictMode>,
);
