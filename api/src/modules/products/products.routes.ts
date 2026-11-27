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
import { requirePermission } from "../../middleware/authorization.middleware.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);

router.post("/", requirePermission("products.manage"), requireCsrf, createProductController);
router.get("/", requirePermission("products.read"), getProductsController);
router.get("/:productId/material-requirements", requirePermission("products.read"), getProductMaterialRequirementsController);
router.post("/:productId/material-requirements", requirePermission("products.bom.manage"), requireCsrf, createProductMaterialRequirementController);
router.patch("/:productId/material-requirements/:requirementId", requirePermission("products.bom.manage"), requireCsrf, updateProductMaterialRequirementController);
router.delete("/:productId/material-requirements/:requirementId", requirePermission("products.bom.manage"), requireCsrf, removeProductMaterialRequirementController);

export default router;
