import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import {
  createOrderController,
  createOrderMaterialEstimateController,
  createOrderPricingController,
  getOrdersController,
  getOrderMaterialEstimateController,
  getOrderMaterialEstimatesController,
  getOrderPricingController,
  getOrderByIdController,
  updateOrderStatusController,
} from "./orders.controller.js";
import { createOrderInvoiceController, getOrderInvoiceController } from "../invoices/invoices.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("orders.manage"), requireCsrf, createOrderController);
router.get("/", requirePermission("orders.read"), getOrdersController);
router.get("/:id/material-estimates", requirePermission("production.materialCosts.read"), getOrderMaterialEstimatesController);
router.get("/:id/material-estimates/:estimateId", requirePermission("production.materialCosts.read"), getOrderMaterialEstimateController);
router.post("/:id/material-estimates", requirePermission("production.materialCosts.manage"), requireCsrf, createOrderMaterialEstimateController);
router.get("/:id/pricing", requirePermission("orders.pricing.read"), getOrderPricingController);
router.post("/:id/pricing", requirePermission("orders.pricing.manage"), requireCsrf, createOrderPricingController);
router.post("/:id/invoice", requirePermission("invoices.manage"), requireCsrf, createOrderInvoiceController);
router.get("/:id/invoice", requirePermission("invoices.read"), getOrderInvoiceController);
router.get("/:id", requirePermission("orders.read"), getOrderByIdController);
router.patch("/:id/status", requirePermission("orders.manage"), requireCsrf, updateOrderStatusController);

export default router;
