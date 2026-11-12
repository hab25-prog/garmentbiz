import { Router } from "express";
import {
  createMaterialController,
  getMaterialsController,
} from "./materials.controller.js";
import {
  authenticate,
  requireActiveBusinessMembership,
  requireCsrf,
} from "../../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requireCsrf, createMaterialController);
router.get("/", getMaterialsController);

export default router;
