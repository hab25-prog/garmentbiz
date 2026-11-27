import { Router } from "express";
import { authenticate, requireActiveBusinessMembership, requireCsrf } from "../../middleware/auth.middleware.js";
import {
  createExpenseController,
  getExpenseController,
  listExpensesController,
  updateExpenseController,
  voidExpenseController,
} from "./expenses.controller.js";

const router = Router();

router.use(authenticate, requireActiveBusinessMembership);
router.post("/", requireCsrf, createExpenseController);
router.get("/", listExpensesController);
router.get("/:expenseId", getExpenseController);
router.patch("/:expenseId", requireCsrf, updateExpenseController);
router.post("/:expenseId/void", requireCsrf, voidExpenseController);

export default router;
