import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import {
  createOrderController,
  createOrderMaterialEstimateController,
  getOrdersController,
  getOrderMaterialEstimateController,
  getOrderMaterialEstimatesController,
  getOrderByIdController,
  updateOrderStatusController,
} from "./orders.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createOrderController);
router.get("/", getOrdersController);
router.get("/:id/material-estimates", getOrderMaterialEstimatesController);
router.get("/:id/material-estimates/:estimateId", getOrderMaterialEstimateController);
router.post("/:id/material-estimates", requireCsrf, createOrderMaterialEstimateController);
router.get("/:id", getOrderByIdController);
router.patch("/:id/status", requireCsrf, updateOrderStatusController);

export default router;
