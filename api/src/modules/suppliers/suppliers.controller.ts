import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createSupplier, getSuppliers } from "./suppliers.service.js";

export async function createSupplierController(req: Request, res: Response) {
  try {
    const { name, contactName, phone, email, address, notes } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (
      typeof name !== "string" ||
      !name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Supplier name is required",
      });
    }

    const optionalFields = {
      contactName,
      phone,
      email,
      address,
      notes,
    };

    for (const [field, value] of Object.entries(optionalFields)) {
      if (value !== undefined && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string`,
        });
      }
    }
    if (typeof email === "string" && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }

    const supplier = await createSupplier({
      businessId,
      name: name.trim(),
      ...(contactName !== undefined ? { contactName: contactName.trim() } : {}),
      ...(phone !== undefined ? { phone: phone.trim() } : {}),
      ...(email !== undefined ? { email: email.trim() } : {}),
      ...(address !== undefined ? { address: address.trim() } : {}),
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Create supplier error:", error);

    if (error instanceof Error && error.message === "Business not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    if (error instanceof Error && error.message === "A supplier with this name already exists for this business") {
      return res.status(409).json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create supplier",
    });
  }
}

export async function getSuppliersController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const suppliers = await getSuppliers(businessId);

    return res.status(200).json({
      success: true,
      data: suppliers,
    });
  } catch (error) {
    console.error("Get suppliers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve suppliers",
    });
  }
}
