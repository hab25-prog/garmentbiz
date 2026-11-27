import { apiClient, ApiError } from "../../../lib/api-client";
import { clearAccessToken, setAccessToken } from "../../../lib/access-token";
import type {
  AuthenticatedProfile,
  AuthenticatedSession,
  EmailVerificationResponse,
  LoginInput,
  RegistrationAcceptedResponse,
  RegisterInput,
  UserLanguage,
} from "../types/auth.types";

let refreshRequest: Promise<AuthenticatedSession> | null = null;

export function fetchCsrfToken(): Promise<string> {
  return apiClient.getCsrfToken();
}

async function postWithCsrf<T>(endpoint: string, body?: unknown, responseFormat: "data" | "envelope" = "data"): Promise<T> {
  const token = await fetchCsrfToken();
  return apiClient.post<T>(endpoint, body, {
    credentials: "include",
    authenticated: false,
    responseFormat,
    headers: { "X-CSRF-Token": token },
  });
}

export async function register(input: RegisterInput): Promise<RegistrationAcceptedResponse> {
  return postWithCsrf<RegistrationAcceptedResponse>("/api/auth/register", input, "envelope");
}

export async function verifyEmail(token: string): Promise<EmailVerificationResponse> {
  return postWithCsrf<EmailVerificationResponse>("/api/auth/verify-email", { token }, "envelope");
}

export async function requestVerificationEmail(email: string): Promise<{ success: true; message: string }> {
  return postWithCsrf<{ success: true; message: string }>(
    "/api/auth/resend-verification",
    { email },
    "envelope",
  );
}

export async function login(input: LoginInput): Promise<AuthenticatedSession> {
  const session = await postWithCsrf<AuthenticatedSession>("/api/auth/login", input);
  setAccessToken(session.accessToken);
  return session;
}

async function performRefresh(): Promise<AuthenticatedSession> {
  try {
    const session = await postWithCsrf<AuthenticatedSession>("/api/auth/refresh");
    setAccessToken(session.accessToken);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) clearAccessToken();
    throw error;
  }
}

export function refreshAccessToken(): Promise<AuthenticatedSession> {
  if (!refreshRequest) {
    const request = performRefresh().finally(() => {
      refreshRequest = null;
    });
    refreshRequest = request;
  }
  return refreshRequest;
}

export async function logout(): Promise<void> {
  try {
    await postWithCsrf<null>("/api/auth/logout");
  } finally {
    clearAccessToken();
    apiClient.clearCsrfToken();
  }
}

export function getAuthenticatedProfile(): Promise<AuthenticatedProfile> {
  return apiClient.get<AuthenticatedProfile>("/api/auth/me");
}

export function getUserLanguagePreference(): Promise<{ language: UserLanguage }> {
  return apiClient.get<{ language: UserLanguage }>("/api/auth/me/language");
}

export function updateUserLanguagePreference(language: UserLanguage): Promise<{ language: UserLanguage }> {
  return apiClient.patch<{ language: UserLanguage }>("/api/auth/me/language", { language });
}
