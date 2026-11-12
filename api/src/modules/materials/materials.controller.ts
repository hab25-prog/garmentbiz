import type { Request, Response } from "express";
import type { MaterialType } from "../../../generated/prisma/client.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createMaterial, getMaterials } from "./materials.service.js";

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
    if (
      typeof unitId !== "string" ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "unitId and name are required",
      });
    }

    const material = await createMaterial({
      businessId,
      unitId,
      name: name.trim(),
      ...(typeof sku === "string" ? { sku } : {}),
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

    const materials = await getMaterials(businessId);

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
