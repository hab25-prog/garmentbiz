import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { test } from "node:test";
import authRoutes from "../src/modules/auth/auth.routes.js";
import {
  loginRateLimit,
  refreshRateLimit,
  registrationRateLimit,
} from "../src/modules/auth/auth.rate-limit.js";

class TestResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  body: unknown;
  private readonly headers = new Map<string, string>();

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  setHeader(name: string, value: string | number) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  append(name: string, value: string) {
    this.setHeader(name, value);
    return this;
  }
}

async function attempt(limiter: typeof loginRateLimit, ip: string) {
  const request = {
    ip,
    headers: {},
    method: "POST",
    path: "/test",
    app: { get: () => false },
  } as unknown as Request;
  const response = new TestResponse();
  return new Promise<{ status: number; headers: TestResponse; body: unknown }>((resolve, reject) => {
    const next = (error?: unknown) => {
      if (error) return reject(error);
      response.statusCode = 403;
      response.emit("finish");
      return resolve({ status: response.statusCode, headers: response, body: response.body });
    };
    try {
      const result = limiter(request, response as unknown as Response, next);
      Promise.resolve(result).catch(reject);
    } catch (error) {
      reject(error);
    }
    response.json = (body: unknown) => {
      response.body = body;
      response.headersSent = true;
      resolve({ status: response.statusCode, headers: response, body });
      return response;
    };
  });
}

async function assertRateLimit(limiter: typeof loginRateLimit, count: number, ip: string) {
  for (let attemptNumber = 1; attemptNumber <= count + 1; attemptNumber += 1) {
    const response = await attempt(limiter, ip);
    if (attemptNumber <= count) {
      assert.equal(response.status, 403);
      continue;
    }
    assert.equal(response.status, 429);
    const retryAfter = response.headers.getHeader("Retry-After");
    assert.ok(retryAfter && Number(retryAfter) > 0);
    assert.ok(Number((response.body as { retryAfterSeconds?: number }).retryAfterSeconds) > 0);
  }
}

test("login rate limit returns 429 and retry timing after ten attempts", async () => {
  await assertRateLimit(loginRateLimit, 10, "192.0.2.10");
});

test("registration rate limit returns 429 and retry timing after five attempts", async () => {
  await assertRateLimit(registrationRateLimit, 5, "192.0.2.11");
});

test("refresh rate limit returns 429 and retry timing after twenty attempts", async () => {
  await assertRateLimit(refreshRateLimit, 20, "192.0.2.12");
});

test("rate-limit buckets are scoped to each client IP", async () => {
  for (let attemptNumber = 0; attemptNumber < 10; attemptNumber += 1) {
    assert.equal((await attempt(loginRateLimit, "192.0.2.13")).status, 403);
  }
  assert.equal((await attempt(loginRateLimit, "192.0.2.14")).status, 403);
});

test("auth routes mount the limiter before CSRF and controller middleware", () => {
  const layers = (authRoutes as unknown as {
    stack: Array<{ route?: { path?: string; stack: Array<{ handle: unknown }> } }>;
  }).stack;
  const expected = [
    ["/login", loginRateLimit],
    ["/register", registrationRateLimit],
    ["/refresh", refreshRateLimit],
  ] as const;
  for (const [path, limiter] of expected) {
    const route = layers.find((layer) => layer.route?.path === path)?.route;
    assert.ok(route);
    assert.equal(route.stack[0]?.handle, limiter);
  }
});
