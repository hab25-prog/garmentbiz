import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import "./toast.css";
import { ToastContext, type ToastType } from "./toast-context";
import { useLanguage } from "./LanguageProvider";

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

const durations: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
};
const duplicateWindowMs = 2500;
const maximumVisibleToasts = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);
  const recentMessages = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const text = message.trim();
    if (!text) return;

    const now = Date.now();
    const signature = `${type}:${text}`;
    const lastShown = recentMessages.current.get(signature);
    if (lastShown !== undefined && now - lastShown < duplicateWindowMs) return;
    recentMessages.current.set(signature, now);

    for (const [key, timestamp] of recentMessages.current) {
      if (now - timestamp >= duplicateWindowMs) recentMessages.current.delete(key);
    }

    const toast: ToastMessage = {
      id: ++nextId.current,
      type,
      message: text,
      duration: durations[type],
    };
    setMessages((current) => [...current, toast].slice(-maximumVisibleToasts));
  }, []);

  const success = useCallback((message: string) => addToast("success", message), [addToast]);
  const error = useCallback((message: string) => addToast("error", message), [addToast]);
  const info = useCallback((message: string) => addToast("info", message), [addToast]);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      <ol className="toast-viewport" aria-label={t("Notifications")}>
        {messages.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} translate={t} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  translate,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
  translate(text: string): string;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timeout = window.setTimeout(
      () => onDismiss(toast.id),
      remaining.current,
    );
    return () => window.clearTimeout(timeout);
  }, [onDismiss, paused, toast.id]);

  const pause = () => {
    if (paused) return;
    remaining.current = Math.max(
      0,
      remaining.current - (Date.now() - startedAt.current),
    );
    setPaused(true);
  };

  const resume = () => setPaused(false);
  const Icon = toast.type === "success"
    ? CheckCircle2
    : toast.type === "error"
      ? AlertCircle
      : Info;

  return (
    <li
      className={`toast toast-${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
      }}
    >
      <Icon className="toast-icon" size={20} aria-hidden="true" />
      <p>{translate(toast.message)}</p>
      <button
        type="button"
        className="toast-dismiss"
        aria-label={translate("Dismiss notification")}
        onClick={() => onDismiss(toast.id)}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </li>
  );
}
