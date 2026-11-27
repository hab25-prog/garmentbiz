import { Router } from "express";
import {
  createEmployeeController,
  createEmployeeInvitationController,
  acceptEmployeeInvitationController,
  getEmployeesController,
  resendEmployeeInvitationController,
  revokeEmployeeInvitationController,
  updateEmployeeController,
} from "./employees.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import { employeeInvitationAcceptanceRateLimit } from "../auth/auth.rate-limit.js";

const router = Router();

// Public invitation acceptance: the bearer token is sent only in the POST body.
router.post("/invitations/accept", employeeInvitationAcceptanceRateLimit, requireCsrf, acceptEmployeeInvitationController);

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("employees.manage"), requireCsrf, createEmployeeController);
router.post("/:employeeId/invitations", requirePermission("employees.invite"), requireCsrf, createEmployeeInvitationController);
router.post("/:employeeId/invitations/resend", requirePermission("employees.invite"), requireCsrf, resendEmployeeInvitationController);
router.post("/:employeeId/invitations/revoke", requirePermission("employees.invite"), requireCsrf, revokeEmployeeInvitationController);
router.patch("/:employeeId", requirePermission("employees.manage"), requireCsrf, updateEmployeeController);
router.get("/", requirePermission("employees.read.basic"), getEmployeesController);

export default router;
