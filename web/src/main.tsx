import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { QueryProvider } from "./app/providers/QueryProvider";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./features/auth/context/AuthProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryProvider>
  </StrictMode>,
);
