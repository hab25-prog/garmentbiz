import { Router } from "express";
import {
  authenticatedCurrentUser,
  getCurrentUserLanguageController,
  getCsrfTokenController,
  loginController,
  logoutController,
  refreshController,
  registerController,
  resendVerificationController,
  verifyEmailController,
  updateCurrentUserLanguageController,
} from "./auth.controller.js";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../../middleware/auth.middleware.js";
import {
  loginRateLimit,
  refreshRateLimit,
  registrationRateLimit,
  verificationRateLimit,
  verificationResendRateLimit,
} from "./auth.rate-limit.js";

const router = Router();

router.get("/csrf", getCsrfTokenController);
router.post("/register", registrationRateLimit, requireCsrf, registerController);
router.post("/verify-email", verificationRateLimit, requireCsrf, verifyEmailController);
router.post("/resend-verification", verificationResendRateLimit, requireCsrf, resendVerificationController);
router.post("/login", loginRateLimit, requireCsrf, loginController);
router.post("/refresh", refreshRateLimit, requireCsrf, refreshController);
router.post("/logout", requireCsrf, logoutController);
router.get("/me", authenticatedCurrentUser);
router.get("/me/language", authenticate, requireActiveBusinessMembership, getCurrentUserLanguageController);
router.patch("/me/language", authenticate, requireActiveBusinessMembership, requireCsrf, updateCurrentUserLanguageController);

export default router;
