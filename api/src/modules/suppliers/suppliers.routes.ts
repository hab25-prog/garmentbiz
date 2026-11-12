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

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createSupplierController);
router.get("/", getSuppliersController);

export default router;
