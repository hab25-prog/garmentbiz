import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";
import {
  createUnitController,
  getUnitsController,
  initializeDefaultUnitsController,
} from "./units.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.post("/defaults", requireCsrf, initializeDefaultUnitsController);
router.post("/", requireCsrf, createUnitController);
router.get("/", getUnitsController);

export default router;
