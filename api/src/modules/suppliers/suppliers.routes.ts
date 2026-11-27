import { Router } from "express";
import {
  createSupplierController,
  getSuppliersController,
} from "./suppliers.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("suppliers.manage"), requireCsrf, createSupplierController);
router.get("/", requirePermission("suppliers.read"), getSuppliersController);

export default router;
