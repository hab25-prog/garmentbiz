import type { Request, Response } from "express";
import type { MaterialType, StockMovementType } from "../../../generated/prisma/client.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { redactFinancialFields } from "../../authorization/financial-fields.js";
import { roleHasPermission } from "../../authorization/permissions.js";
import { createMaterial, getMaterials, updateMaterial, getInventorySummary, getStockMovements } from "./materials.service.js";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createMaterialController(req: Request, res: Response) {
  try {
    const { unitId, name, sku, type, description, reorderLevel } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;
    const allowedTypes: MaterialType[] = [
      "FABRIC",
      "POLYMER",
      "THREAD",
      "ACCESSORY",
      "PACKAGING",
      "OTHER",
    ];

    if (type !== undefined && !allowedTypes.includes(type as MaterialType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material type",
      });
    }
    if (typeof unitId !== "string" || !unitId || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "unitId and name are required",
      });
    }
    if (reorderLevel !== undefined && (typeof reorderLevel !== "number" || !Number.isFinite(reorderLevel) || reorderLevel < 0)) {
      return res.status(400).json({ success: false, message: "Reorder level must be a non-negative number" });
    }
    if (sku !== undefined && typeof sku !== "string") {
      return res.status(400).json({ success: false, message: "SKU must be text" });
    }
    if (description !== undefined && typeof description !== "string") {
      return res.status(400).json({ success: false, message: "Description must be text" });
    }

    const material = await createMaterial({
      businessId,
      unitId,
      name: name.trim(),
      ...(typeof sku === "string" && sku.trim() ? { sku: sku.trim() } : {}),
      ...(typeof type === "string" ? { type: type as MaterialType } : {}),
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof reorderLevel === "number" ? { reorderLevel } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Material created successfully",
      data: material,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: "A material with this SKU already exists for this business" });
    }
    const message =
      error instanceof Error ? error.message : "Failed to create material";

    if (
      message === "Business not found" ||
      message === "Measurement unit not found for this business"
    ) {
      return res.status(400).json({
        success: false,
        message,
      });
    }

    console.error("Create material error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create material",
    });
  }
}

export async function getMaterialsController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const materials = await getMaterials(businessId, req.query.includeArchived === "true");

    return res.json({
      success: true,
      data: materials,
    });
  } catch (error) {
    console.error("Get materials error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve materials",
    });
  }
}

export async function updateMaterialController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const body = req.body ?? {};
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
      return res.status(400).json({ success: false, message: "Material name cannot be empty" });
    }
    if (body.unitId !== undefined && (typeof body.unitId !== "string" || !body.unitId)) {
      return res.status(400).json({ success: false, message: "A valid measurement unit is required" });
    }
    if (body.sku !== undefined && body.sku !== null && typeof body.sku !== "string") {
      return res.status(400).json({ success: false, message: "SKU must be text" });
    }
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
      return res.status(400).json({ success: false, message: "Description must be text" });
    }
    if (body.reorderLevel !== undefined && (typeof body.reorderLevel !== "number" || !Number.isFinite(body.reorderLevel) || body.reorderLevel < 0)) {
      return res.status(400).json({ success: false, message: "Reorder level must be a non-negative number" });
    }
    const allowedTypes: MaterialType[] = ["FABRIC", "POLYMER", "THREAD", "ACCESSORY", "PACKAGING", "OTHER"];
    if (body.type !== undefined && !allowedTypes.includes(body.type as MaterialType)) {
      return res.status(400).json({ success: false, message: "Invalid material type" });
    }
    const data = await updateMaterial(businessId, id, {
      ...(typeof body.unitId === "string" ? { unitId: body.unitId } : {}),
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.sku === "string" ? { sku: body.sku } : body.sku === null ? { sku: "" } : {}),
      ...(typeof body.description === "string" || body.description === null ? { description: body.description } : {}),
      ...(typeof body.type === "string" ? { type: body.type as MaterialType } : {}),
      ...(typeof body.reorderLevel === "number" ? { reorderLevel: body.reorderLevel } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
    });
    if (!data) return res.status(404).json({ success: false, message: "Material not found" });
    return res.json({ success: true, data });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: "A material with this SKU already exists for this business" });
    }
    if (error instanceof Error && error.message === "Measurement unit not found for this business") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof Error && error.message === "A material unit cannot be changed after inventory or purchase history exists") {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error("Update material error:", error);
    return res.status(500).json({ success: false, message: "Failed to update material" });
  }
}
export async function inventorySummaryController(req:Request,res:Response){try{const businessId=assertRequestedBusiness(req,res,req.query.businessId);if(!businessId)return;const data=await getInventorySummary(businessId);return res.json({success:true,data:roleHasPermission(req.businessPrincipal?.role,"inventory.costs.read")?data:redactFinancialFields(data)});}catch(error){console.error("Inventory summary error:",error);return res.status(500).json({success:false,message:"Failed to retrieve inventory summary"});}}
export async function stockMovementsController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;
    const allowedTypes: StockMovementType[] = ["PURCHASE", "MANUAL_RECEIPT", "INVENTORY_ISSUE", "INVENTORY_RETURN", "INVENTORY_WASTE", "PRODUCTION_ISSUE", "PRODUCTION_RETURN", "PRODUCTION_WASTE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
    if (typeof req.query.type === "string" && !allowedTypes.includes(req.query.type as StockMovementType)) {
      return res.status(400).json({ success: false, message: "Invalid stock movement type" });
    }
    const filters: { materialId?: string; type?: StockMovementType; search?: string } = {
      ...(typeof req.query.materialId === "string" ? { materialId: req.query.materialId } : {}),
      ...(typeof req.query.type === "string" ? { type: req.query.type as StockMovementType } : {}),
      ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
    };
    const movements = await getStockMovements(businessId, filters);
    return res.json({ success: true, data: roleHasPermission(req.businessPrincipal?.role,"inventory.costs.read")?movements:redactFinancialFields(movements) });
  } catch (error) {
    console.error("Stock history error:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve stock movements" });
  }
}
