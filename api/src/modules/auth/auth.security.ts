import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const REFRESH_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-garmentbiz_refresh" : "garmentbiz_refresh";
export const CSRF_COOKIE_NAME = "garmentbiz_csrf";
export const REFRESH_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCESS_TOKEN_DURATION_SECONDS = 15 * 60;
export const JWT_ISSUER = process.env.JWT_ISSUER ?? "garmentbiz-api";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "garmentbiz-web";

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  mid: string;
  bid: string;
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getJwtKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 bytes");
  }
  return new TextEncoder().encode(secret);
}

export function assertJwtConfiguration(): void {
  getJwtKey();
}

export async function createAccessToken(identity: {
  userId: string;
  membershipId: string;
  businessId: string;
}): Promise<string> {
  return new SignJWT({ mid: identity.membershipId, bid: identity.businessId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(identity.userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_DURATION_SECONDS}s`)
    .sign(getJwtKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload, protectedHeader } = await jwtVerify(token, getJwtKey(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  if (
    protectedHeader.typ !== "JWT" ||
    typeof payload.sub !== "string" ||
    typeof payload.mid !== "string" ||
    typeof payload.bid !== "string"
  ) {
    throw new Error("Invalid access token claims");
  }
  return payload as AccessTokenClaims;
}

function cookieAttributes(httpOnly: boolean, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production";
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE ?? "Lax";
  if (!["Strict", "Lax", "None"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be Strict, Lax, or None");
  }
  if (sameSite === "None" && !secure) {
    throw new Error("SameSite=None cookies require production Secure cookies");
  }
  return [
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${sameSite}`,
    ...(secure ? ["Secure"] : []),
    ...(httpOnly ? ["HttpOnly"] : []),
  ].join("; ");
}

export function setRefreshCookie(response: Response, token: string): void {
  response.append(
    "Set-Cookie",
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(true, REFRESH_DURATION_MS / 1000)}`,
  );
}

export function clearRefreshCookie(response: Response): void {
  response.append(
    "Set-Cookie",
    `${REFRESH_COOKIE_NAME}=; ${cookieAttributes(true, 0)}`,
  );
}

export function setCsrfCookie(response: Response, token: string): void {
  response.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(false, 60 * 60 * 24)}`,
  );
}

export function clearCsrfCookie(response: Response): void {
  response.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=; ${cookieAttributes(false, 0)}`,
  );
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function csrfRequestIsValid(request: Request): boolean {
  const origin = request.get("origin");
  const csrfCookie = readCookie(request, CSRF_COOKIE_NAME);
  const csrfHeader = request.get("x-csrf-token");
  const allowedOrigins = getAllowedOrigins();
  return Boolean(
    origin && allowedOrigins.has(origin) && csrfCookie && csrfHeader && csrfCookie === csrfHeader,
  );
}

export function getAllowedOrigins(): Set<string> {
  const configured = process.env.WEB_ORIGINS;
  if (configured?.trim()) {
    return new Set(configured.split(",").map((origin) => origin.trim()).filter(Boolean));
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("WEB_ORIGINS must be configured in production");
  }
  return new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
}
