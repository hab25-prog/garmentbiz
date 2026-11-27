import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import { getFinancialDashboardController, getOperationalDashboardController } from "./dashboard.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.get("/operational", requirePermission("dashboard.operational.read"), getOperationalDashboardController);
router.get("/financial", requirePermission("dashboard.financial.read"), getFinancialDashboardController);

export default router;
