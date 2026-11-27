import type { Request, Response } from "express";
import { roleHasPermission } from "../../authorization/permissions.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { InvoiceServiceError, createOrderInvoice, getInvoice, getInvoicePaymentHistory, getOrderInvoice, issueInvoice } from "./invoices.service.js";
import { recordInvoicePayment } from "./payments.service.js";

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function business(req: Request, res: Response): string | undefined {
  return assertRequestedBusiness(req, res, undefined);
}

function handleError(res: Response, error: unknown) {
  if (error instanceof InvoiceServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error("Invoice request failed:", error);
  return res.status(500).json({ success: false, message: "Failed to process invoice request" });
}

function canManageInvoices(req: Request, res: Response): boolean {
  const role = req.businessPrincipal?.role;
  if (roleHasPermission(role, "invoices.manage")) return true;
  res.status(403).json({ success: false, message: "You do not have permission to manage invoices" });
  return false;
}

function orderParam(req: Request): unknown {
  return req.params.orderId ?? req.params.id;
}

export async function createOrderInvoiceController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!canManageInvoices(req, res)) return;
    if (!validId(orderParam(req))) return res.status(400).json({ success: false, message: "Invalid order ID" });
    const invoice = await createOrderInvoice(businessId, orderParam(req) as string);
    if (!invoice) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(201).json({ success: true, message: "Draft invoice created", data: invoice });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getOrderInvoiceController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!validId(orderParam(req))) return res.status(400).json({ success: false, message: "Invalid order ID" });
    const invoice = await getOrderInvoice(businessId, orderParam(req) as string);
    if (!invoice) return res.status(404).json({ success: false, message: "Order invoice not found" });
    return res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getInvoiceController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!validId(req.params.invoiceId)) return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    const invoice = await getInvoice(businessId, req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getInvoicePaymentHistoryController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!validId(req.params.invoiceId)) return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    const paymentHistory = await getInvoicePaymentHistory(businessId, req.params.invoiceId);
    if (!paymentHistory) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.status(200).json({ success: true, data: paymentHistory });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function issueInvoiceController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!canManageInvoices(req, res)) return;
    if (!validId(req.params.invoiceId)) return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    const invoice = await issueInvoice(businessId, req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.status(200).json({ success: true, message: "Invoice issued", data: invoice });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function recordInvoicePaymentController(req: Request, res: Response) {
  try {
    const businessId = business(req, res);
    if (!businessId) return;
    if (!canManageInvoices(req, res)) return;
    if (!validId(req.params.invoiceId)) return res.status(400).json({ success: false, message: "Invalid invoice ID" });
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "Payment details are required" });
    }
    const result = await recordInvoicePayment(businessId, req.params.invoiceId, {
      amount: req.body.amount,
      method: req.body.method,
      ...(req.body.paymentDate !== undefined ? { paymentDate: req.body.paymentDate } : {}),
      ...(req.body.reference !== undefined ? { reference: req.body.reference } : {}),
      ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
      idempotencyKey: req.body.idempotencyKey,
    });
    if (!result) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed ? "Payment request already recorded" : "Payment recorded",
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
