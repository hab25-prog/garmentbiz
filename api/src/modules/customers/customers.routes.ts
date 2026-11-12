import { Router } from "express";
import {
  createCustomerController,
  getCustomersController,
} from "./customers.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createCustomerController);
router.get("/", getCustomersController);

export default router;
