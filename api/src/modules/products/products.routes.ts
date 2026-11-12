import { Router } from "express";
import {
  createProductController,
  getProductsController,
} from "./products.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createProductController);
router.get("/", getProductsController);

export default router;
