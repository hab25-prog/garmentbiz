import { Router } from "express";
import {
  createPurchaseController,
  getPurchasesController,
  receivePurchaseController,
} from "./purchases.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("purchases.manage"), requireCsrf, createPurchaseController);
router.get("/", requirePermission("purchases.read"), getPurchasesController);
router.post("/:id/receive", requirePermission("purchases.receive"), requireCsrf, receivePurchaseController);

export default router;
