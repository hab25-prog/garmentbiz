import { Router } from "express";
import {
  createProductMaterialRequirementController,
  createProductController,
  getProductMaterialRequirementsController,
  getProductsController,
  removeProductMaterialRequirementController,
  updateProductMaterialRequirementController,
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
router.get("/:productId/material-requirements", getProductMaterialRequirementsController);
router.post("/:productId/material-requirements", requireCsrf, createProductMaterialRequirementController);
router.patch("/:productId/material-requirements/:requirementId", requireCsrf, updateProductMaterialRequirementController);
router.delete("/:productId/material-requirements/:requirementId", requireCsrf, removeProductMaterialRequirementController);

export default router;
