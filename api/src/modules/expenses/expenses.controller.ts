import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { requireExpenseManageAccess, requireExpenseReadAccess } from "./expenses.authorization.js";
import { ExpenseRequestError, parseCreateExpense, parseExpenseListQuery, parseUpdateExpense, parseVoidExpense } from "./expenses.validation.js";
import { createExpense, ExpenseServiceError, getExpense, listExpenses, updateExpense, voidExpense } from "./expenses.service.js";

function handleError(res: Response, error: unknown, action: string) {
  if (error instanceof ExpenseRequestError || error instanceof ExpenseServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error(`Expense ${action} failed:`, error);
  return res.status(500).json({ success: false, message: `Failed to ${action} expense` });
}

function authenticatedActor(req: Request, res: Response) {
  const principal = req.businessPrincipal;
  if (!principal) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return undefined;
  }
  const businessId = assertRequestedBusiness(req, res, undefined);
  if (!businessId) return undefined;
  return { businessId, userId: principal.userId, membershipId: principal.membershipId };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createExpenseController(req: Request, res: Response) {
  try {
    const actor = authenticatedActor(req, res);
    if (!actor || !requireExpenseManageAccess(req, res)) return;
    if (!assertRequestedBusiness(req, res, req.body?.businessId)) return;
    const result = await createExpense(actor, parseCreateExpense(req.body));
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed ? "Expense request already recorded" : "Expense created successfully",
      data: { ...result.expense, replayed: result.replayed },
    });
  } catch (error) {
    return handleError(res, error, "create");
  }
}

export async function listExpensesController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId || !requireExpenseReadAccess(req, res)) return;
    const result = await listExpenses(businessId, parseExpenseListQuery(req.query));
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "retrieve");
  }
}

export async function getExpenseController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId || !requireExpenseReadAccess(req, res)) return;
    if (!validId(req.params.expenseId)) return res.status(400).json({ success: false, message: "Invalid expense ID" });
    const expense = await getExpense(businessId, req.params.expenseId);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    return res.status(200).json({ success: true, data: expense });
  } catch (error) {
    return handleError(res, error, "retrieve");
  }
}

export async function updateExpenseController(req: Request, res: Response) {
  try {
    const actor = authenticatedActor(req, res);
    if (!actor || !requireExpenseManageAccess(req, res)) return;
    if (!assertRequestedBusiness(req, res, req.body?.businessId)) return;
    if (!validId(req.params.expenseId)) return res.status(400).json({ success: false, message: "Invalid expense ID" });
    const expense = await updateExpense(actor, req.params.expenseId, parseUpdateExpense(req.body));
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    return res.status(200).json({ success: true, message: "Expense updated successfully", data: expense });
  } catch (error) {
    return handleError(res, error, "update");
  }
}

export async function voidExpenseController(req: Request, res: Response) {
  try {
    const actor = authenticatedActor(req, res);
    if (!actor || !requireExpenseManageAccess(req, res)) return;
    if (!assertRequestedBusiness(req, res, req.body?.businessId)) return;
    if (!validId(req.params.expenseId)) return res.status(400).json({ success: false, message: "Invalid expense ID" });
    const expense = await voidExpense(actor, req.params.expenseId, parseVoidExpense(req.body));
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    return res.status(200).json({ success: true, message: "Expense voided successfully", data: expense });
  } catch (error) {
    return handleError(res, error, "void");
  }
}
