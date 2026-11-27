import type { Request, Response } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
} from "../../middleware/auth.middleware.js";
import {
  AuthError,
  getCurrentUser,
  getUserLanguage,
  isUserLanguage,
  login,
  refresh,
  resendVerification,
  register,
  revokeRefreshToken,
  verifyEmail,
  updateUserLanguage,
} from "./auth.service.js";
import {
  clearCsrfCookie,
  clearRefreshCookie,
  createOpaqueToken,
  getAllowedOrigins,
  readCookie,
  REFRESH_COOKIE_NAME,
  setCsrfCookie,
  setRefreshCookie,
} from "./auth.security.js";
import { VERIFICATION_RESEND_GENERIC_MESSAGE } from "./auth.service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestBody(request: Request): Record<string, unknown> | undefined {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}

function validateCredentials(email: unknown, password: unknown): string | undefined {
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254) {
    return "A valid email address is required";
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return "Password must be between 12 and 128 characters";
  }
  return undefined;
}

function authErrorResponse(response: Response, error: unknown, operation: string) {
  if (error instanceof AuthError) {
    if (error.code === "EMAIL_EXISTS") {
      return response.status(409).json({
        success: false,
        message: "Unable to register with these details. Sign in if you already have an account.",
      });
    }
    if (error.code === "BUSINESS_SELECTION_REQUIRED") {
      return response.status(409).json({ success: false, message: error.message });
    }
    if (error.code === "EMAIL_NOT_VERIFIED") {
      return response.status(403).json({ success: false, message: error.message });
    }
    if (error.code === "VERIFICATION_TOKEN_INVALID") {
      return response.status(400).json({ success: false, message: error.message });
    }
    if (error.code === "REFRESH_REUSED") clearRefreshCookie(response);
    return response.status(401).json({ success: false, message: error.message });
  }
  console.error(`${operation} error:`, error);
  return response.status(500).json({ success: false, message: `${operation} failed` });
}

async function respondWithTokens(
  response: Response,
  tokens: Awaited<ReturnType<typeof login>>,
  message: string,
  statusCode = 200,
) {
  const current = await getCurrentUser(tokens);
  setRefreshCookie(response, tokens.refreshToken);
  return response.status(statusCode).json({
    success: true,
    message,
    data: { accessToken: tokens.accessToken, ...current },
  });
}

export function getCsrfTokenController(request: Request, response: Response) {
  const origin = request.get("origin");
  if (origin && !getAllowedOrigins().has(origin)) {
    return response.status(403).json({ success: false, message: "Origin not allowed" });
  }
  const token = createOpaqueToken();
  setCsrfCookie(response, token);
  return response.status(200).json({ success: true, data: { csrfToken: token } });
}

export async function registerController(request: Request, response: Response) {
  try {
    const body = requestBody(request);
    if (!body) return response.status(400).json({ success: false, message: "Invalid request body" });
    const { fullName, email, password, businessName, language } = body;
    const credentialError = validateCredentials(email, password);
    if (credentialError) return response.status(400).json({ success: false, message: credentialError });
    if (typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 120) {
      return response.status(400).json({ success: false, message: "Full name is required (maximum 120 characters)" });
    }
    if (typeof businessName !== "string" || !businessName.trim() || businessName.trim().length > 160) {
      return response.status(400).json({ success: false, message: "Business name is required (maximum 160 characters)" });
    }
    if (language !== undefined && !isUserLanguage(language)) {
      return response.status(400).json({ success: false, message: "Language must be either en or am" });
    }

    await register({
      fullName: fullName.trim(),
      email: (email as string).trim().toLowerCase(),
      password: password as string,
      businessName: businessName.trim(),
      ...(language !== undefined ? { language } : {}),
    });
    return response.status(202).json({
      success: true,
      message: VERIFICATION_RESEND_GENERIC_MESSAGE,
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === "EMAIL_EXISTS") {
      return response.status(202).json({
        success: true,
        message: VERIFICATION_RESEND_GENERIC_MESSAGE,
      });
    }
    return authErrorResponse(response, error, "Registration");
  }
}

export async function verifyEmailController(request: Request, response: Response) {
  if (request.query.token !== undefined) {
    return response.status(400).json({ success: false, message: "Submit the verification token in the request body" });
  }
  const body = requestBody(request);
  if (!body || typeof body.token !== "string" || body.token.length > 128) {
    return response.status(400).json({ success: false, message: "A valid verification token is required" });
  }
  try {
    await verifyEmail(body.token);
    return response.status(200).json({ success: true, message: "Email verified. You can now sign in." });
  } catch (error) {
    return authErrorResponse(response, error, "Email verification");
  }
}

export async function resendVerificationController(request: Request, response: Response) {
  const body = requestBody(request);
  if (!body || typeof body.email !== "string" || !EMAIL_PATTERN.test(body.email.trim()) || body.email.trim().length > 254) {
    return response.status(400).json({ success: false, message: "A valid email address is required" });
  }
  try {
    await resendVerification(body.email.trim().toLowerCase());
  } catch {
    // Preserve the same response and avoid leaking account or SMTP state.
  }
  return response.status(202).json({ success: true, message: VERIFICATION_RESEND_GENERIC_MESSAGE });
}

export async function loginController(request: Request, response: Response) {
  try {
    const body = requestBody(request);
    if (!body) return response.status(400).json({ success: false, message: "Invalid request body" });
    const { email, password, businessId } = body;
    const credentialError = validateCredentials(email, password);
    if (credentialError) return response.status(400).json({ success: false, message: credentialError });
    if (businessId !== undefined && (typeof businessId !== "string" || !businessId.trim())) {
      return response.status(400).json({ success: false, message: "businessId must be a nonblank string when provided" });
    }

    const tokens = await login({
      email: (email as string).trim().toLowerCase(),
      password: password as string,
      ...(typeof businessId === "string" ? { businessId: businessId.trim() } : {}),
    });
    return await respondWithTokens(response, tokens, "Login successful");
  } catch (error) {
    return authErrorResponse(response, error, "Login");
  }
}

export async function refreshController(request: Request, response: Response) {
  try {
    const tokens = await refresh(readCookie(request, REFRESH_COOKIE_NAME));
    return await respondWithTokens(response, tokens, "Token refreshed");
  } catch (error) {
    if (error instanceof AuthError) clearRefreshCookie(response);
    return authErrorResponse(response, error, "Refresh");
  }
}

export async function logoutController(request: Request, response: Response) {
  try {
    await revokeRefreshToken(readCookie(request, REFRESH_COOKIE_NAME));
    clearRefreshCookie(response);
    clearCsrfCookie(response);
    return response.status(200).json({ success: true, message: "Logout successful", data: null });
  } catch (error) {
    return authErrorResponse(response, error, "Logout");
  }
}

export async function currentUserController(request: Request, response: Response) {
  try {
    if (!request.authPrincipal) {
      return response.status(401).json({ success: false, message: "Authentication required" });
    }
    const current = await getCurrentUser(request.authPrincipal);
    return response.status(200).json({ success: true, data: current });
  } catch (error) {
    return authErrorResponse(response, error, "Current user lookup");
  }
}

export const authenticatedCurrentUser = [
  authenticate,
  requireActiveBusinessMembership,
  currentUserController,
];

export async function getCurrentUserLanguageController(request: Request, response: Response) {
  const userId = request.authPrincipal?.userId;
  if (!userId) return response.status(401).json({ success: false, message: "Authentication required" });
  try {
    const language = await getUserLanguage(userId);
    if (!language) return response.status(404).json({ success: false, message: "User preference not found" });
    return response.status(200).json({ success: true, data: { language } });
  } catch {
    return response.status(500).json({ success: false, message: "Unable to load language preference" });
  }
}

export async function updateCurrentUserLanguageController(request: Request, response: Response) {
  const userId = request.authPrincipal?.userId;
  if (!userId) return response.status(401).json({ success: false, message: "Authentication required" });
  const body = requestBody(request);
  if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "language") || !isUserLanguage(body.language)) {
    return response.status(400).json({ success: false, message: "Language must be either en or am" });
  }
  try {
    const language = await updateUserLanguage(userId, body.language);
    return response.status(200).json({ success: true, data: { language } });
  } catch {
    return response.status(500).json({ success: false, message: "Unable to update language preference" });
  }
}
