import { Router } from "express";
import {
  createEmployeeController,
  getEmployeesController,
} from "./employees.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createEmployeeController);
router.get("/", getEmployeesController);

export default router;
