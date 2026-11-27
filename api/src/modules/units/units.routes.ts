import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import {
  createUnitController,
  getUnitsController,
  initializeDefaultUnitsController,
} from "./units.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.post("/defaults", requirePermission("units.manage"), requireCsrf, initializeDefaultUnitsController);
router.post("/", requirePermission("units.manage"), requireCsrf, createUnitController);
router.get("/", requirePermission("units.read"), getUnitsController);

export default router;
