import type { Request, Response } from "express";
import { roleHasPermission } from "../../authorization/permissions.js";
import { restrictNestedEmployeeDetails, redactFinancialFields } from "../../authorization/financial-fields.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
} from "./orders.service.js";
import {
  createOrderMaterialEstimate,
  getOrderMaterialEstimate,
  getOrderMaterialEstimates,
} from "./order-material-estimates.service.js";
import { createOrderPricingCalculation, getOrderPricing } from "./order-pricing.service.js";

function orderEstimateBusiness(req: Request, res: Response) {
  return assertRequestedBusiness(req, res, req.body?.businessId ?? req.query.businessId);
}

function estimateError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to process order material estimate";
  if (message.includes("outside this business") || message.includes("invalid for this business")) {
    return res.status(409).json({ success: false, message: "Order material configuration is inconsistent. Review the product and material setup." });
  }
  if (message.includes("changed during estimation")) {
    return res.status(409).json({ success: false, message: "Order or material requirements changed during estimation. Please try again." });
  }
  console.error("Order material estimate error:", error);
  return res.status(500).json({ success: false, message: "Failed to process order material estimate" });
}

function validPathId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeOrderData(req: Request, data: unknown) {
  const safeFinancials = roleHasPermission(req.businessPrincipal?.role, "dashboard.financial.read")
    ? data
    : redactFinancialFields(data);
  return req.businessPrincipal?.role === "OWNER" || req.businessPrincipal?.role === "ADMIN"
    ? safeFinancials
    : restrictNestedEmployeeDetails(safeFinancials);
}

function pricingError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to process order pricing";
  if (message === "A material estimate is required before pricing can be calculated" ||
      message.startsWith("The latest material estimate is incomplete")) {
    return res.status(409).json({ success: false, message });
  }
  if (message.startsWith("Markup must") || message === "Order quantity must be greater than zero" || message.startsWith("Pricing result exceeds")) {
    return res.status(400).json({ success: false, message });
  }
  console.error("Order pricing error:", error);
  return res.status(500).json({ success: false, message: "Failed to process order pricing" });
}

export async function getOrderPricingController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, undefined);
    if (!businessId) return;
    if (!validPathId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid order ID" });
    const pricing = await getOrderPricing(businessId, req.params.id);
    if (!pricing) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(200).json({ success: true, data: pricing });
  } catch (error) {
    return pricingError(res, error);
  }
}

export async function createOrderPricingController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, undefined);
    if (!businessId) return;
    if (!roleHasPermission(req.businessPrincipal?.role, "orders.pricing.manage")) {
      return res.status(403).json({ success: false, message: "Only the business owner can calculate or change order pricing" });
    }
    if (!validPathId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid order ID" });
    if (req.body?.markupPercent !== undefined && typeof req.body.markupPercent !== "string") {
      return res.status(400).json({ success: false, message: "Markup must be supplied as a decimal percentage string" });
    }
    const calculation = await createOrderPricingCalculation(
      businessId,
      req.params.id,
      req.body?.markupPercent,
    );
    if (!calculation) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(201).json({ success: true, message: "Minimum selling price calculated", data: calculation });
  } catch (error) {
    return pricingError(res, error);
  }
}

export async function getOrderMaterialEstimatesController(req: Request, res: Response) {
  try {
    const businessId = orderEstimateBusiness(req, res);
    if (!businessId) return;
    if (!validPathId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid order ID" });
    const estimates = await getOrderMaterialEstimates(businessId, req.params.id);
    if (!estimates) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(200).json({ success: true, data: estimates });
  } catch (error) {
    return estimateError(res, error);
  }
}

export async function getOrderMaterialEstimateController(req: Request, res: Response) {
  try {
    const businessId = orderEstimateBusiness(req, res);
    if (!businessId) return;
    if (!validPathId(req.params.id) || !validPathId(req.params.estimateId)) {
      return res.status(400).json({ success: false, message: "Invalid order estimate" });
    }
    const estimate = await getOrderMaterialEstimate(businessId, req.params.id, req.params.estimateId);
    if (!estimate) return res.status(404).json({ success: false, message: "Order estimate not found" });
    return res.status(200).json({ success: true, data: estimate });
  } catch (error) {
    return estimateError(res, error);
  }
}

export async function createOrderMaterialEstimateController(req: Request, res: Response) {
  try {
    const businessId = orderEstimateBusiness(req, res);
    if (!businessId) return;
    if (!validPathId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid order ID" });
    const estimate = await createOrderMaterialEstimate(businessId, req.params.id);
    if (!estimate) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(201).json({
      success: true,
      message: "Order material estimate saved",
      data: estimate,
    });
  } catch (error) {
    return estimateError(res, error);
  }
}

export async function createOrderController(req: Request, res: Response) {
  try {
    const { customerId, orderDate, dueDate, notes, items } = req.body ?? {};

    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);

    if (!businessId) return;

    if (typeof customerId !== "string" || !customerId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer is required",
      });
    }

    if (
      orderDate !== undefined &&
      (typeof orderDate !== "string" || !orderDate.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Order date must be a valid date string",
      });
    }

    if (
      dueDate !== undefined &&
      (typeof dueDate !== "string" || !dueDate.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Due date must be a valid date string",
      });
    }

    if (notes !== undefined && typeof notes !== "string") {
      return res.status(400).json({
        success: false,
        message: "Notes must be a string",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "An order must contain at least one item",
      });
    }

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return res.status(400).json({
          success: false,
          message: "Each order item must be an object",
        });
      }

      if (typeof item.productId !== "string" || !item.productId.trim()) {
        return res.status(400).json({
          success: false,
          message: "Every order item must have a product",
        });
      }

      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Item quantities must be positive whole numbers",
        });
      }

      if (
        item.unitPrice !== undefined &&
        typeof item.unitPrice !== "string" &&
        typeof item.unitPrice !== "number"
      ) {
        return res.status(400).json({
          success: false,
          message: "Unit price must be a number",
        });
      }

      if (
        item.description !== undefined &&
        typeof item.description !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Item description must be a string",
        });
      }
    }

    const order = await createOrder({
      businessId,
      customerId: customerId.trim(),
      ...(orderDate !== undefined ? { orderDate } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
      allowCustomUnitPrice: req.businessPrincipal?.role !== "MANAGER",
      items: items.map((item) => ({
        productId: item.productId.trim(),
        quantity: item.quantity,
        ...(item.unitPrice !== undefined ? { unitPrice: item.unitPrice } : {}),
        ...(item.description !== undefined
          ? { description: item.description.trim() }
          : {}),
      })),
    });

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: safeOrderData(req, order),
    });
  } catch (error) {
    console.error("Create order error:", error);

    if (error instanceof Error && error.message === "Managers cannot change order pricing") {
      return res.status(403).json({ success: false, message: error.message });
    }

    const clientErrors = [
      "An order must contain at least one item",
      "An order cannot contain more than 100 items",
      "Customer is required",
      "Invalid order date",
      "Invalid due date",
      "Due date cannot be before the order date",
      "Every order item must have a product",
      "A product can only appear once in an order",
      "Item quantities must be positive whole numbers",
      "Unit prices must be valid non-negative amounts with up to 2 decimal places",
      "Customer not found or inactive",
      "One or more products were not found or are inactive",
      "Product not found",
    ];

    if (error instanceof Error && clientErrors.includes(error.message)) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      error.message.startsWith("A unit price is required")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create order",
    });
  }
}

export async function getOrdersController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);

    if (!businessId) return;

    const orders = await getOrders(businessId);

    return res.status(200).json({
      success: true,
      data: safeOrderData(req, orders),
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve orders",
    });
  }
}

export async function getOrderByIdController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, undefined);
    if (!businessId) return;

    const orderId = req.params.id;
    if (typeof orderId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await getOrderById(businessId, orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: safeOrderData(req, order),
    });
  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve order",
    });
  }
}

export async function updateOrderStatusController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, undefined);
    if (!businessId) return;

    const orderId = req.params.id;
    if (typeof orderId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const { status } = req.body ?? {};

    if (typeof status !== "string" || !status.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid order status is required",
      });
    }

    const order = await updateOrderStatus(businessId, orderId, status.trim());

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      data: safeOrderData(req, order),
    });
  } catch (error) {
    console.error("Update order status error:", error);

    if (error instanceof Error && error.message === "Order not found") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      (error.message === "Invalid order status" ||
        error.message.startsWith("Cannot change order status") ||
        error.message.startsWith("At least one active production batch") ||
        error.message.startsWith("An order cannot be completed") ||
        error.message.startsWith("Production batch ") ||
        error.message.includes("remaining to produce"))
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      error.message.includes("changed concurrently")
    ) {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return res.status(409).json({ success: false, message: "Order or production changed concurrently. Please reload and try again." });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
    });
  }
}
