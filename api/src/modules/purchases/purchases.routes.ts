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

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createPurchaseController);
router.get("/", getPurchasesController);
router.post("/:id/receive", requireCsrf, receivePurchaseController);

export default router;
