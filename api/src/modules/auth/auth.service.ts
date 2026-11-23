import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
import { ensureDefaultUnits } from "../units/units.service.js";
import {
  assertJwtConfiguration,
  createAccessToken,
  createOpaqueToken,
  hashToken,
  REFRESH_DURATION_MS,
} from "./auth.security.js";

export class AuthError extends Error {
  constructor(
    public readonly code:
      | "EMAIL_EXISTS"
      | "INVALID_CREDENTIALS"
      | "BUSINESS_SELECTION_REQUIRED"
      | "REFRESH_INVALID"
      | "REFRESH_REUSED",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  businessName: string;
}

export interface LoginInput {
  email: string;
  password: string;
  businessId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  userId: string;
  membershipId: string;
  businessId: string;
}

interface RefreshTokenRecord {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

const dummyPasswordHash = argon2.hash(randomBytes(32).toString("base64url"), {
  type: argon2.argon2id,
});

async function createRefreshToken(
  client: typeof prisma | Prisma.TransactionClient,
  membershipId: string,
): Promise<RefreshTokenRecord> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_DURATION_MS);
  const session = await client.session.create({
    data: {
      membershipId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { sessionId: session.id, token, expiresAt };
}

async function issueAuthTokens(
  identity: { userId: string; membershipId: string; businessId: string },
  refresh: RefreshTokenRecord,
): Promise<AuthTokens> {
  return {
    accessToken: await createAccessToken(identity),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    ...identity,
  };
}

export async function register(input: RegisterInput): Promise<AuthTokens> {
  assertJwtConfiguration();
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });

  try {
    const issued = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          fullName: input.fullName,
          email: input.email.toLowerCase(),
          passwordHash,
        },
        select: { id: true },
      });
      const business = await transaction.business.create({
        data: { name: input.businessName },
        select: { id: true },
      });
      await ensureDefaultUnits(transaction, business.id);
      const membership = await transaction.membership.create({
        data: { userId: user.id, businessId: business.id, role: "OWNER" },
        select: { id: true },
      });
      const refresh = await createRefreshToken(transaction, membership.id);
      return {
        identity: { userId: user.id, membershipId: membership.id, businessId: business.id },
        refresh,
      };
    });
    return issueAuthTokens(issued.identity, issued.refresh);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AuthError("EMAIL_EXISTS", "Unable to complete account registration");
    }
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthTokens> {
  assertJwtConfiguration();
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      memberships: {
        where: { isActive: true, business: { isActive: true } },
        select: { id: true, businessId: true },
      },
    },
  });

  let passwordIsValid = false;
  if (user && typeof user.passwordHash === "string" && user.passwordHash.length > 0) {
    try {
      passwordIsValid = await argon2.verify(user.passwordHash, input.password);
    } catch {
      await argon2.verify(await dummyPasswordHash, input.password).catch(() => false);
    }
  } else {
    await argon2.verify(await dummyPasswordHash, input.password).catch(() => false);
  }
  if (!user || !user.isActive || !passwordIsValid) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  let membership;
  if (input.businessId) {
    membership = user.memberships.find((item) => item.businessId === input.businessId);
    if (!membership) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
    }
  } else if (user.memberships.length === 1) {
    membership = user.memberships[0];
  } else if (user.memberships.length > 1) {
    throw new AuthError("BUSINESS_SELECTION_REQUIRED", "Select a business membership to continue");
  } else {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!membership) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  const refresh = await createRefreshToken(prisma, membership.id);
  return issueAuthTokens(
    { userId: user.id, membershipId: membership.id, businessId: membership.businessId },
    refresh,
  );
}

async function revokeUserRefreshTokens(userId: string): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { id: true },
  });
  await prisma.session.updateMany({
    where: {
      membershipId: { in: memberships.map((membership) => membership.id) },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function refresh(refreshToken: string | undefined): Promise<AuthTokens> {
  assertJwtConfiguration();
  if (!refreshToken) {
    throw new AuthError("REFRESH_INVALID", "Refresh token is invalid or expired");
  }

  const tokenHash = hashToken(refreshToken);
  const current = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      membership: {
        include: {
          user: { select: { id: true, isActive: true } },
          business: { select: { id: true, isActive: true } },
        },
      },
    },
  });
  if (!current) {
    throw new AuthError("REFRESH_INVALID", "Refresh token is invalid or expired");
  }
  if (current.revokedAt) {
    if (current.rotatedToSessionId) {
      await revokeUserRefreshTokens(current.membership.userId);
      throw new AuthError("REFRESH_REUSED", "Refresh token reuse detected; sign in again");
    }
    throw new AuthError("REFRESH_INVALID", "Refresh token is invalid or expired");
  }
  if (
    current.expiresAt <= new Date() ||
    !current.membership.isActive ||
    !current.membership.user.isActive ||
    !current.membership.business.isActive
  ) {
    await prisma.session.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AuthError("REFRESH_INVALID", "Refresh token is invalid or expired");
  }

  const rotated = await prisma.$transaction(async (transaction) => {
    const update = await transaction.session.updateMany({
      where: {
        id: current.id,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (update.count !== 1) {
      const latest = await transaction.session.findUnique({
        where: { id: current.id },
        select: { rotatedToSessionId: true },
      });
      return { reused: Boolean(latest?.rotatedToSessionId) } as const;
    }

    const newRefresh = await createRefreshToken(transaction, current.membershipId);
    await transaction.session.update({
      where: { id: current.id },
      data: { rotatedToSessionId: newRefresh.sessionId },
    });
    return { reused: false, refresh: newRefresh } as const;
  });

  if (rotated.reused) {
    await revokeUserRefreshTokens(current.membership.userId);
    throw new AuthError("REFRESH_REUSED", "Refresh token reuse detected; sign in again");
  }
  if (!rotated.refresh) {
    throw new AuthError("REFRESH_INVALID", "Refresh token is invalid or expired");
  }
  return issueAuthTokens(
    {
      userId: current.membership.userId,
      membershipId: current.membershipId,
      businessId: current.membership.businessId,
    },
    rotated.refresh,
  );
}

export async function revokeRefreshToken(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date(), rotatedToSessionId: null },
  });
}

export async function getCurrentUser(principal: {
  userId: string;
  membershipId: string;
}) {
  const membership = await prisma.membership.findFirst({
    where: {
      id: principal.membershipId,
      userId: principal.userId,
      isActive: true,
      business: { isActive: true },
      user: { isActive: true },
    },
    select: {
      role: true,
      business: { select: { id: true, name: true } },
      user: { select: { id: true, fullName: true, email: true } },
    },
  });
  if (!membership) {
    throw new AuthError("INVALID_CREDENTIALS", "Active business membership required");
  }
  return {
    user: membership.user,
    membership: { role: membership.role, business: membership.business },
  };
}
