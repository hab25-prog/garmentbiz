import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import { SignJWT } from "jose";
import type { Request } from "express";
import {
  createOpaqueToken,
  csrfRequestIsValid,
  hashToken,
  createAccessToken,
  verifyAccessToken,
  JWT_ISSUER,
  JWT_AUDIENCE,
} from "../src/modules/auth/auth.security.js";

const TEST_JWT_SECRET = "test-only-jwt-secret-with-at-least-32-bytes";

test("access JWTs verify identity, issuer, audience and expiry", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  const token = await createAccessToken({
    userId: "user-1",
    membershipId: "membership-1",
    businessId: "business-1",
  });
  const claims = await verifyAccessToken(token);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.mid, "membership-1");
  assert.equal(claims.bid, "business-1");
  const tokenParts = token.split(".");
  const signature = tokenParts[2];

  assert.ok(signature);

  tokenParts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

  await assert.rejects(verifyAccessToken(tokenParts.join(".")));

  const wrongAudience = await new SignJWT({
    mid: "membership-1",
    bid: "business-1",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("user-1")
    .setIssuer(JWT_ISSUER)
    .setAudience("unexpected-audience")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
  await assert.rejects(verifyAccessToken(wrongAudience));

  const expired = await new SignJWT({ mid: "membership-1", bid: "business-1" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("user-1")
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
  await assert.rejects(verifyAccessToken(expired));
});

test("opaque session tokens are high entropy and stored as one-way hashes", () => {
  const token = createOpaqueToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(hashToken(token).length, 64);
  assert.notEqual(hashToken(token), token);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(createOpaqueToken()));
});

test("Argon2id hashes verify the original password and reject a different one", async () => {
  const passwordHash = await argon2.hash("correct horse battery staple", {
    type: argon2.argon2id,
  });
  assert.notEqual(passwordHash, "correct horse battery staple");
  assert.equal(
    await argon2.verify(passwordHash, "correct horse battery staple"),
    true,
  );
  assert.equal(await argon2.verify(passwordHash, "different password"), false);
});

test("CSRF requires an allowed origin and matching cookie and request header", () => {
  const previousOrigins = process.env.WEB_ORIGINS;
  process.env.WEB_ORIGINS = "https://garmentbiz.example";
  const token = createOpaqueToken();

  const makeRequest = (origin: string, csrfHeader: string) =>
    ({
      headers: { cookie: `garmentbiz_csrf=${token}` },
      get(name: string) {
        if (name === "origin") return origin;
        if (name.toLowerCase() === "x-csrf-token") return csrfHeader;
        return undefined;
      },
    }) as unknown as Request;

  try {
    assert.equal(
      csrfRequestIsValid(makeRequest("https://garmentbiz.example", token)),
      true,
    );
    assert.equal(
      csrfRequestIsValid(makeRequest("https://attacker.example", token)),
      false,
    );
    assert.equal(
      csrfRequestIsValid(makeRequest("https://garmentbiz.example", "wrong")),
      false,
    );
  } finally {
    if (previousOrigins === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = previousOrigins;
  }
});
