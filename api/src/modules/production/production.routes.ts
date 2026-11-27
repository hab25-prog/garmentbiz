import { Router } from "express";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import * as c from "./production.controller.js";
const router=Router(); router.use(authenticate,requireActiveBusinessMembership);
router.get("/",requirePermission("production.read"),c.list); router.post("/",requirePermission("production.manage"),requireCsrf,c.create); router.get("/:id",requirePermission("production.read"),c.detail); router.patch("/:id",requirePermission("production.manage"),requireCsrf,c.update); router.patch("/:id/status",requirePermission("production.manage"),requireCsrf,c.status);
router.post("/:id/material-issues",requirePermission("production.manage"),requireCsrf,c.issue); router.get("/:id/material-usage",requirePermission("production.read"),c.usage); router.patch("/:id/material-usage/:usageId",requirePermission("production.manage"),requireCsrf,c.reconcile);
router.get("/:id/cost-sheet",requirePermission("production.materialCosts.read"),c.costSheet); router.put("/:id/cost-sheet",requirePermission("production.materialCosts.manage"),requireCsrf,c.saveCostSheet); router.post("/:id/calculate-cost",requirePermission("production.materialCosts.manage"),requireCsrf,c.calculate); export default router;
