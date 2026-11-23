import type { Request, Response } from "express";
import { Prisma } from "../../../generated/prisma/client.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import {
  createProduct,
  createProductMaterialRequirement,
  getProductMaterialRequirements,
  getProducts,
  parseBomQuantity,
  removeProductMaterialRequirement,
  updateProductMaterialRequirement,
} from "./products.service.js";

function bomBusiness(req: Request, res: Response): string | undefined {
  return assertRequestedBusiness(req, res, req.body?.businessId ?? req.query.businessId);
}

function bomError(res: Response, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, message: "This material is already included in the product requirements" });
  }
  const message = error instanceof Error ? error.message : "Failed to save product material requirement";
  if (message === "Product not found for this business" || message === "Active material not found for this business") {
    return res.status(404).json({ success: false, message });
  }
  if (message.startsWith("Required quantity")) {
    return res.status(400).json({ success: false, message });
  }
  console.error("Product material requirements error:", error);
  return res.status(500).json({ success: false, message: "Failed to save product material requirement" });
}

function routeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getProductMaterialRequirementsController(req: Request, res: Response) {
  try {
    const businessId = bomBusiness(req, res);
    if (!businessId) return;
    if (!routeId(req.params.productId)) return res.status(400).json({ success: false, message: "Invalid product ID" });
    const requirements = await getProductMaterialRequirements(businessId, req.params.productId);
    if (!requirements) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data: requirements });
  } catch (error) {
    return bomError(res, error);
  }
}

export async function createProductMaterialRequirementController(req: Request, res: Response) {
  try {
    const businessId = bomBusiness(req, res);
    if (!businessId) return;
    const { materialId, quantityPerUnit } = req.body ?? {};
    if (!routeId(req.params.productId) || !routeId(materialId)) {
      return res.status(400).json({ success: false, message: "A valid product and material are required" });
    }
    const requirement = await createProductMaterialRequirement(
      businessId,
      req.params.productId,
      materialId,
      parseBomQuantity(quantityPerUnit),
    );
    return res.status(201).json({ success: true, message: "Material requirement added", data: requirement });
  } catch (error) {
    return bomError(res, error);
  }
}

export async function updateProductMaterialRequirementController(req: Request, res: Response) {
  try {
    const businessId = bomBusiness(req, res);
    if (!businessId) return;
    if (!routeId(req.params.productId) || !routeId(req.params.requirementId)) {
      return res.status(400).json({ success: false, message: "Invalid product material requirement" });
    }
    const requirement = await updateProductMaterialRequirement(
      businessId,
      req.params.productId,
      req.params.requirementId,
      parseBomQuantity(req.body?.quantityPerUnit),
    );
    if (!requirement) return res.status(404).json({ success: false, message: "Product material requirement not found" });
    return res.status(200).json({ success: true, message: "Material requirement updated", data: requirement });
  } catch (error) {
    return bomError(res, error);
  }
}

export async function removeProductMaterialRequirementController(req: Request, res: Response) {
  try {
    const businessId = bomBusiness(req, res);
    if (!businessId) return;
    if (!routeId(req.params.productId) || !routeId(req.params.requirementId)) {
      return res.status(400).json({ success: false, message: "Invalid product material requirement" });
    }
    const removed = await removeProductMaterialRequirement(businessId, req.params.productId, req.params.requirementId);
    if (!removed) return res.status(404).json({ success: false, message: "Product material requirement not found" });
    return res.status(200).json({ success: true, message: "Material requirement removed", data: { removed: true } });
  } catch (error) {
    return bomError(res, error);
  }
}

const optionalStringFields = ["sku", "description", "category"] as const;
const MAX_BASE_PRICE = new Prisma.Decimal("9999999999.99");

export async function createProductController(req: Request, res: Response) {
  try {
    const { name, sku, description, category, basePrice } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const optionalFields = { sku, description, category };
    for (const field of optionalStringFields) {
      const value = optionalFields[field];
      if (value !== undefined && value !== null && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string`,
        });
      }
    }

    let decimalBasePrice: Prisma.Decimal | undefined;
    if (basePrice !== undefined && basePrice !== null && basePrice !== "") {
      if (
        (typeof basePrice !== "string" && typeof basePrice !== "number") ||
        (typeof basePrice === "string" && !/^\d+(\.\d{1,2})?$/.test(basePrice.trim())) ||
        (typeof basePrice === "number" && !Number.isFinite(basePrice))
      ) {
        return res.status(400).json({
          success: false,
          message: "basePrice must be a non-negative decimal with at most two decimal places",
        });
      }

      try {
        decimalBasePrice = new Prisma.Decimal(basePrice);
      } catch {
        return res.status(400).json({
          success: false,
          message: "basePrice must be a valid decimal",
        });
      }

      if (
        !decimalBasePrice.isFinite() ||
        decimalBasePrice.isNegative() ||
        decimalBasePrice.greaterThan(MAX_BASE_PRICE)
      ) {
        return res.status(400).json({
          success: false,
          message: "basePrice must be between 0 and 9999999999.99",
        });
      }
    }

    const product = await createProduct({
      businessId,
      name: name.trim(),
      ...(typeof sku === "string" && sku.trim() ? { sku: sku.trim() } : {}),
      ...(typeof description === "string" && description.trim()
        ? { description: description.trim() }
        : {}),
      ...(typeof category === "string" && category.trim()
        ? { category: category.trim() }
        : {}),
      ...(decimalBasePrice !== undefined ? { basePrice: decimalBasePrice } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Business not found") {
      return res.status(404).json({ success: false, message: error.message });
    }

    if (
      error instanceof Error &&
      error.message === "Product SKU already exists for this business"
    ) {
      return res.status(409).json({ success: false, message: error.message });
    }

    console.error("Create product error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
}

export async function getProductsController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const products = await getProducts(businessId);
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    console.error("Get products error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve products",
    });
  }
}
