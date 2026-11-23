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

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createMaterialController);
router.get("/inventory-summary",inventorySummaryController);
router.get("/stock-movements",stockMovementsController);
router.patch("/:id",requireCsrf,updateMaterialController);
router.get("/", getMaterialsController);

export default router;
