import type { Request, Response } from "express";
import { Prisma } from "../../../generated/prisma/client.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createProduct, getProducts } from "./products.service.js";

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
