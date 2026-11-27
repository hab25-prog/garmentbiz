import { environment } from "../config/environment";
import { getAccessToken } from "./access-token";

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

interface CsrfTokenResponse {
  csrfToken: string;
}

export interface ApiRequestOptions extends RequestInit {
  /** Set false for public authentication endpoints that should not carry a stale bearer token. */
  authenticated?: boolean;
  /** Return the success envelope itself for endpoints whose contract has no `data` property. */
  responseFormat?: "data" | "envelope";
}

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

function responseMessage(result: unknown): string | undefined {
  if (
    typeof result === "object" &&
    result !== null &&
    "message" in result &&
    typeof result.message === "string"
  ) {
    return result.message;
  }
  return undefined;
}

function userMessage(status: number, serverMessage?: string): string {
  if (status === 0) {
    return "Unable to connect. Check your internet connection and try again.";
  }
  if (status === 401) {
    return serverMessage || "Your session has expired. Please sign in again.";
  }
  if (status === 403 && serverMessage === "CSRF validation failed") {
    return "Your security session expired. Please try again.";
  }
  if (status === 403 && serverMessage === "Origin not allowed") {
    return "Email verification could not start from this site. Please contact support.";
  }
  if (status === 403) {
    const approvedMessages = new Set([
      "Please verify your email before signing in.",
      "You do not have permission to complete this action.",
      "You do not have permission to manage employee invitations",
      "Only the business owner can calculate or change order pricing",
      "Managers cannot change order pricing",
      "Active business membership is required",
    ]);
    if (serverMessage && approvedMessages.has(serverMessage)) return serverMessage;
    return "You do not have permission to complete this action.";
  }
  if (status === 400 || status === 404 || status === 409 || status === 410 || status === 422) {
    const safeMessage = serverMessage && serverMessage.length <= 240 &&
      !/(?:prisma|sql|stack trace|exception|constraint|database|internal server|\bat\s+\w+\s*\()/i.test(serverMessage)
      ? serverMessage
      : undefined;
    return safeMessage || "Please review the information and try again.";
  }
  if (status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (status >= 500) {
    return "The service could not complete your request. Please try again later.";
  }
  return serverMessage || "Something went wrong. Please try again.";
}

function isMutation(method?: string): boolean {
  return method !== undefined && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

async function loadCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (csrfTokenRequest) return csrfTokenRequest;

  csrfTokenRequest = request<CsrfTokenResponse>(
    "/api/auth/csrf",
    { authenticated: false },
    false,
  )
    .then(({ csrfToken: token }) => {
      if (typeof token !== "string" || token.length === 0) {
        throw new ApiError("Unable to establish a secure session. Please reload and try again.", 500);
      }
      csrfToken = token;
      return token;
    })
    .finally(() => {
      csrfTokenRequest = null;
    });

  return csrfTokenRequest;
}

async function request<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
  retryCsrf = true,
): Promise<T> {
  const { authenticated = true, responseFormat = "data", ...fetchOptions } = options;
  const method = (fetchOptions.method ?? "GET").toUpperCase();
  const headers = new Headers(fetchOptions.headers);
  if (fetchOptions.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isMutation(method)) {
    headers.set("X-CSRF-Token", await loadCsrfToken());
  }

  const accessToken = authenticated ? getAccessToken() : null;
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${environment.apiUrl}${endpoint}`, {
      ...fetchOptions,
      credentials: fetchOptions.credentials ?? "include",
      headers,
    });
  } catch (error) {
    // Browser/network errors can contain implementation details. Keep those in developer logs only.
    console.error("API request could not reach the server", error);
    throw new ApiError(userMessage(0), 0);
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(userMessage(response.status), response.status);
  }

  const message = responseMessage(result);
  if (!response.ok) {
    if (response.status === 403 && message === "CSRF validation failed" && retryCsrf) {
      csrfToken = null;
      csrfTokenRequest = null;
      return request<T>(endpoint, options, false);
    }
    throw new ApiError(userMessage(response.status, message), response.status);
  }

  if (
    typeof result !== "object" ||
    result === null ||
    !("success" in result) ||
    result.success !== true
  ) {
    throw new ApiError("The server returned an unexpected response. Please try again.", response.status);
  }

  if (responseFormat === "envelope") return result as T;

  if (!("data" in result)) {
    throw new ApiError("The server returned an unexpected response. Please try again.", response.status);
  }

  return (result as ApiResponse<T>).data;
}

export const apiClient = {
  getCsrfToken(): Promise<string> {
    return loadCsrfToken();
  },

  clearCsrfToken(): void {
    csrfToken = null;
    csrfTokenRequest = null;
  },

  get<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, options);
  },

  post<T>(
    endpoint: string,
    body?: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    return request<T>(endpoint, {
      body: JSON.stringify(body),
      ...options,
      method: "POST",
    });
  },

  put<T>(
    endpoint: string,
    body: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    return request<T>(endpoint, {
      body: JSON.stringify(body),
      ...options,
      method: "PUT",
    });
  },

  patch<T>(
    endpoint: string,
    body: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    return request<T>(endpoint, {
      body: JSON.stringify(body),
      ...options,
      method: "PATCH",
    });
  },

  delete<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  },
};
