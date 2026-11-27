import { Router } from "express";
import {
  createMaterialController,
  getMaterialsController,
  updateMaterialController, inventorySummaryController, stockMovementsController,
} from "./materials.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("materials.manage"), requireCsrf, createMaterialController);
router.get("/inventory-summary",requirePermission("inventory.read"),inventorySummaryController);
router.get("/stock-movements",requirePermission("inventory.read"),stockMovementsController);
router.patch("/:id",requirePermission("materials.manage"),requireCsrf,updateMaterialController);
router.get("/", requirePermission("materials.read"), getMaterialsController);

export default router;
