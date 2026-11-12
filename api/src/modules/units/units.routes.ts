import { Router } from "express";
import {
  authenticate,
  requireActiveBusinessMembership,
} from "../../middleware/auth.middleware.js";
import { getUnitsController } from "./units.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.get("/", getUnitsController);

export default router;
