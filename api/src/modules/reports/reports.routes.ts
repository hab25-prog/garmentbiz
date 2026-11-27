import { Router } from "express";
import { authenticate, requireActiveBusinessMembership } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import {
  expenseReportController,
  financialSummaryController,
  inventoryValuationController,
  materialPurchasesReportController,
  productionMaterialCostsReportController,
} from "./reports.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.get("/financial/summary", requirePermission("reports.financial.read"), financialSummaryController);
router.get("/financial/expenses", requirePermission("reports.financial.read"), expenseReportController);
router.get("/financial/material-purchases", requirePermission("reports.financial.read"), materialPurchasesReportController);
router.get("/financial/production-material-costs", requirePermission("reports.financial.read"), productionMaterialCostsReportController);
router.get("/financial/inventory-valuation", requirePermission("inventory.costs.read"), inventoryValuationController);

export default router;
