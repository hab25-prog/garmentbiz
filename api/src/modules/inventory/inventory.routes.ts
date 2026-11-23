import {Router} from "express";
import {authenticate,requireActiveBusinessMembership,requireCsrf} from "../../middleware/auth.middleware.js";
import * as c from "./inventory.controller.js";
const r=Router();r.use(authenticate,requireActiveBusinessMembership);
r.post("/receipts",requireCsrf,c.receive);r.post("/issues",requireCsrf,c.issue);r.post("/returns",requireCsrf,c.returnIssue);r.post("/wastage",requireCsrf,c.waste);r.post("/adjustments/in",requireCsrf,c.adjustmentIn);r.post("/adjustments/out",requireCsrf,c.adjustmentOut);r.route("/unit-conversions").get(c.conversions).post(requireCsrf,c.conversions);r.get("/operations",c.operations);r.get("/balances",c.balances);
export default r;
