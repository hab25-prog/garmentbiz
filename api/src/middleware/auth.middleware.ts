import type { NextFunction, Request, Response } from "express";
import { prisma } from "../database/prisma.js";
import { csrfRequestIsValid, verifyAccessToken } from "../modules/auth/auth.security.js";

export interface AuthenticatedPrincipal {
  userId: string;
  membershipId: string;
  businessId: string;
}

export interface BusinessPrincipal extends AuthenticatedPrincipal {
  role: string;
  businessName: string;
}

declare global {
  namespace Express {
    interface Request {
      authPrincipal?: AuthenticatedPrincipal;
      businessPrincipal?: BusinessPrincipal;
    }
  }
}

function unauthenticated(response: Response) {
  return response.status(401).json({
    success: false,
    message: "Authentication required",
  });
}

function forbidden(response: Response, message = "Active business membership required") {
  return response.status(403).json({ success: false, message });
}

export function getAuthenticatedBusinessId(request: Request): string | undefined {
  return request.businessPrincipal?.businessId;
}

export function assertRequestedBusiness(
  request: Request,
  response: Response,
  requestedBusinessId: unknown,
): string | undefined {
  const businessId = getAuthenticatedBusinessId(request);
  if (!businessId) {
    unauthenticated(response);
    return undefined;
  }
  if (
    requestedBusinessId !== undefined &&
    (typeof requestedBusinessId !== "string" || requestedBusinessId.trim() !== businessId)
  ) {
    forbidden(response, "You cannot access another business");
    return undefined;
  }
  return businessId;
}

export async function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const authorization = request.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1]) return unauthenticated(response);

  try {
    const claims = await verifyAccessToken(match[1]);
    request.authPrincipal = {
      userId: claims.sub,
      membershipId: claims.mid,
      businessId: claims.bid,
    };
    return next();
  } catch {
    return unauthenticated(response);
  }
}

export async function requireActiveBusinessMembership(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const principal = request.authPrincipal;
    if (!principal) return unauthenticated(response);

    const membership = await prisma.membership.findFirst({
      where: {
        id: principal.membershipId,
        userId: principal.userId,
        isActive: true,
        business: { isActive: true },
      },
      select: {
        id: true,
        businessId: true,
        role: true,
        business: { select: { name: true } },
        user: { select: { isActive: true, emailVerifiedAt: true } },
      },
    });
    if (!membership?.user.isActive) return forbidden(response);
    if (!membership.user.emailVerifiedAt) {
      return forbidden(response, "Email verification required");
    }
    if (membership.businessId !== principal.businessId) {
      return forbidden(response, "Token business membership is no longer valid");
    }

    request.businessPrincipal = {
      ...principal,
      role: membership.role,
      businessName: membership.business.name,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireCsrf(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!csrfRequestIsValid(request)) {
    return response.status(403).json({
      success: false,
      message: "CSRF validation failed",
    });
  }
  return next();
}
