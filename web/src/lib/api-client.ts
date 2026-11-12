import { environment } from "../config/environment";
import { getAccessToken } from "./access-token";

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface ApiRequestOptions extends RequestInit {
  /** Set false for public authentication endpoints that should not carry a stale bearer token. */
  authenticated?: boolean;
}


export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}


async function request<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { authenticated = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  if (fetchOptions.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const accessToken = authenticated ? getAccessToken() : null;
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${environment.apiUrl}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an invalid response.",
      response.status,
    );
  }

  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "Something went wrong.";

    throw new ApiError(message, response.status);
  }

  if (
    typeof result !== "object" ||
    result === null ||
    !("success" in result) ||
    result.success !== true ||
    !("data" in result)
  ) {
    throw new ApiError("Invalid API response format.", response.status);
  }

  return (result as ApiResponse<T>).data;
}

export const apiClient = {
  get<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, options);
  },

  post<T>(endpoint: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      body: JSON.stringify(body),
      ...options,
      method: "POST",
    });
  },

  put<T>(endpoint: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      body: JSON.stringify(body),
      ...options,
      method: "PUT",
    });
  },

  delete<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  },
};
