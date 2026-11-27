
import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { redactFinancialFields } from "../../authorization/financial-fields.js";
import { roleHasPermission } from "../../authorization/permissions.js";
import {
  createPurchase,
  getPurchases,
  receivePurchase,
} from "./purchases.service.js";

export async function createPurchaseController(
  req: Request,
  res: Response,
) {
  try {
    const { supplierId, notes, items } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (
      typeof supplierId !== "string" ||
      !supplierId.trim() ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Business, supplier, and at least one purchase item are required",
      });
    }

    if (
      notes !== undefined &&
      typeof notes !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Notes must be a string",
      });
    }

    for (const item of items) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.materialId !== "string" ||
        !item.materialId.trim() ||
        typeof item.quantity !== "string" ||
        typeof item.unitCost !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Each item must contain a material ID, quantity, and unit cost as strings",
        });
      }
    }

    const purchase = await createPurchase({
      businessId,
      supplierId: supplierId.trim(),
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
      items: items.map((item: {
        materialId: string;
        quantity: string;
        unitCost: string;
      }) => ({
        materialId: item.materialId.trim(),
        quantity: item.quantity,
        unitCost: item.unitCost,
      })),
    });

    return res.status(201).json({
      success: true,
      message: "Purchase created successfully",
      data: roleHasPermission(req.businessPrincipal?.role, "inventory.costs.read") ? purchase : redactFinancialFields(purchase),
    });
  } catch (error) {
    console.error("Create purchase error:", error);

    const message =
      error instanceof Error ? error.message : "";

    if (
      message.includes("not found") ||
      message.includes("not be found")
    ) {
      return res.status(404).json({
        success: false,
        message,
      });
    }

    if (
      message.includes("must") ||
      message.includes("cannot") ||
      message.includes("at least one")
    ) {
      return res.status(400).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create purchase",
    });
  }
}

export async function getPurchasesController(
  req: Request,
  res: Response,
) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const purchases = await getPurchases(businessId);

    return res.status(200).json({
      success: true,
      data: roleHasPermission(req.businessPrincipal?.role, "inventory.costs.read") ? purchases : redactFinancialFields(purchases),
    });
  } catch (error) {
    console.error("Get purchases error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve purchases",
    });
  }
}

export async function receivePurchaseController(
  req: Request,
  res: Response,
) {
  try {
    const { id } = req.params;
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (typeof id !== "string" || !id.trim()) {
      return res.status(400).json({
        success: false,
        message: "Purchase ID is required",
      });
    }

    const purchase = await receivePurchase(
      id.trim(),
      businessId,
    );

    return res.status(200).json({
      success: true,
      message: "Purchase received successfully",
      data: roleHasPermission(req.businessPrincipal?.role, "inventory.costs.read") ? purchase : redactFinancialFields(purchase),
    });
  } catch (error) {
    console.error("Receive purchase error:", error);

    const message =
      error instanceof Error ? error.message : "";

    if (message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message,
      });
    }

    if (message.includes("already been received") ||
        message.includes("already received")) {
      return res.status(409).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to receive purchase",
    });
  }
}
