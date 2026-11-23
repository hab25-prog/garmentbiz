import { Router } from "express";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../../middleware/auth.middleware.js";
import * as c from "./production.controller.js";
const router=Router(); router.use(authenticate,requireActiveBusinessMembership);
router.get("/",c.list); router.post("/",requireCsrf,c.create); router.get("/:id",c.detail); router.patch("/:id",requireCsrf,c.update); router.patch("/:id/status",requireCsrf,c.status);
router.post("/:id/material-issues",requireCsrf,c.issue); router.get("/:id/material-usage",c.usage); router.patch("/:id/material-usage/:usageId",requireCsrf,c.reconcile);
router.get("/:id/cost-sheet",c.costSheet); router.put("/:id/cost-sheet",requireCsrf,c.saveCostSheet); router.post("/:id/calculate-cost",requireCsrf,c.calculate); export default router;
