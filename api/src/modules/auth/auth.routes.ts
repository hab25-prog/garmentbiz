import { Router } from "express";
import {
  authenticatedCurrentUser,
  getCsrfTokenController,
  loginController,
  logoutController,
  refreshController,
  registerController,
} from "./auth.controller.js";
import { requireCsrf } from "../../middleware/auth.middleware.js";
import {
  loginRateLimit,
  refreshRateLimit,
  registrationRateLimit,
} from "./auth.rate-limit.js";

const router = Router();

router.get("/csrf", getCsrfTokenController);
router.post("/register", registrationRateLimit, requireCsrf, registerController);
router.post("/login", loginRateLimit, requireCsrf, loginController);
router.post("/refresh", refreshRateLimit, requireCsrf, refreshController);
router.post("/logout", requireCsrf, logoutController);
router.get("/me", authenticatedCurrentUser);

export default router;
