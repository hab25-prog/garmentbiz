import { rateLimit } from "express-rate-limit";

function createAuthRateLimit(options: {
  windowMs: number;
  limit: number;
  message: string;
  skipSuccessfulRequests?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    handler: (_request, response) => {
      const retryAfter = response.getHeader("Retry-After");
      return response.status(429).json({
        success: false,
        message: options.message,
        ...(retryAfter ? { retryAfterSeconds: Number(retryAfter) } : {}),
      });
    },
  });
}

export const registrationRateLimit = createAuthRateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: "Too many registration attempts. Please try again later.",
});

export const loginRateLimit = createAuthRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many sign-in attempts. Please try again later.",
  skipSuccessfulRequests: true,
});

export const refreshRateLimit = createAuthRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "Too many token refresh attempts. Please try again later.",
});
