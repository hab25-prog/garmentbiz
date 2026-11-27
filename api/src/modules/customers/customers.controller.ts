import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createCustomer, CustomerReceivablesError, getCustomerReceivables, getCustomers } from "./customers.service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalStringFields = ["phone", "email", "address", "notes"] as const;

export async function createCustomerController(req: Request, res: Response) {
  try {
    const { name, phone, email, address, notes } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required",
      });
    }

    const optionalFields = { phone, email, address, notes };
    for (const field of optionalStringFields) {
      const value = optionalFields[field];
      if (value !== undefined && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string`,
        });
      }
    }

    const trimmedEmail = typeof email === "string" ? email.trim() : undefined;
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Email must be a valid email address",
      });
    }

    const customer = await createCustomer({
      businessId,
      name: name.trim(),
      ...(phone !== undefined ? { phone: phone.trim() } : {}),
      ...(trimmedEmail !== undefined || email === ""
        ? { email: trimmedEmail ?? "" }
        : {}),
      ...(address !== undefined ? { address: address.trim() } : {}),
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: customer,
    });
  } catch (error) {
    console.error("Create customer error:", error);

    if (error instanceof Error && error.message === "Business not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
    });
  }
}

export async function getCustomersController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const customers = await getCustomers(businessId);

    return res.status(200).json({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve customers",
    });
  }
}

export async function getCustomerReceivablesController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, undefined);
    if (!businessId) return;
    if (typeof req.params.customerId !== "string" || !req.params.customerId.trim()) {
      return res.status(400).json({ success: false, message: "Invalid customer ID" });
    }

    const receivables = await getCustomerReceivables(businessId, req.params.customerId);
    if (!receivables) return res.status(404).json({ success: false, message: "Customer not found" });
    return res.status(200).json({ success: true, data: receivables });
  } catch (error) {
    if (error instanceof CustomerReceivablesError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error("Get customer receivables error:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve customer receivables" });
  }
}
