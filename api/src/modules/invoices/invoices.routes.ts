import { Router } from "express";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import { createOrderInvoiceController, getInvoiceController, getInvoicePaymentHistoryController, getOrderInvoiceController, issueInvoiceController, recordInvoicePaymentController } from "./invoices.controller.js";

const router = Router();
router.use(authenticate, requireActiveBusinessMembership);
router.get("/:invoiceId/payments", requirePermission("payments.read"), getInvoicePaymentHistoryController);
router.get("/:invoiceId", requirePermission("invoices.read"), getInvoiceController);
router.post("/:invoiceId/issue", requirePermission("invoices.manage"), requireCsrf, issueInvoiceController);
router.post("/:invoiceId/payments", requirePermission("payments.manage"), requireCsrf, recordInvoicePaymentController);

export default router;
