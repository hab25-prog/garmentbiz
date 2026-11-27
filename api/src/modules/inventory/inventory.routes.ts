import {Router} from "express";
import {authenticate,requireActiveBusinessMembership,requireCsrf} from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorization.middleware.js";
import * as c from "./inventory.controller.js";
const r=Router();r.use(authenticate,requireActiveBusinessMembership);
r.post("/receipts",requirePermission("inventory.operate"),requireCsrf,c.receive);r.post("/issues",requirePermission("inventory.operate"),requireCsrf,c.issue);r.post("/returns",requirePermission("inventory.operate"),requireCsrf,c.returnIssue);r.post("/wastage",requirePermission("inventory.operate"),requireCsrf,c.waste);r.post("/adjustments/in",requirePermission("inventory.adjust"),requireCsrf,c.adjustmentIn);r.post("/adjustments/out",requirePermission("inventory.adjust"),requireCsrf,c.adjustmentOut);r.route("/unit-conversions").get(requirePermission("inventory.read"),c.conversions).post(requirePermission("inventory.operate"),requireCsrf,c.conversions);r.get("/operations",requirePermission("inventory.read"),c.operations);r.get("/balances",requirePermission("inventory.read"),c.balances);
export default r;
