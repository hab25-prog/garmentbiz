import { Router } from "express";
import {
  createCustomerController,
  getCustomerReceivablesController,
  getCustomersController,
} from "./customers.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("customers.manage"), requireCsrf, createCustomerController);
router.get("/:customerId/receivables", requirePermission("customers.receivables.read"), getCustomerReceivablesController);
router.get("/", requirePermission("customers.read"), getCustomersController);

export default router;
