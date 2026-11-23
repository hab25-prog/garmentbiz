import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import * as service from "./production.service.js";
const bad = [
  "Planned quantity must be a positive whole number",
  "Order not found for this business",
  "Order must be confirmed before production",
  "A valid order item is required",
  "Planned quantity exceeds remaining ordered quantity",
  "Employee not found for this business",
  "Start date must be a valid date",
  "Invalid production status",
  "Completed quantity cannot exceed planned quantity",
  "Material usage must be reconciled before completing production",
  "Production batch not found or not active",
  "Material not found for this business",
  "Quantity must be positive with at most 3 decimal places",
  "Insufficient available stock",
  "Insufficient cost-layer stock",
  "Material usage not found",
  "Consumed quantity must be non-negative with at most 3 decimal places",
  "Wasted quantity must be non-negative with at most 3 decimal places",
  "Returned quantity must be non-negative with at most 3 decimal places",
  "Issued quantity must equal consumed, returned, and wasted quantities",
  "Returned quantity cannot be reduced",
  "Return quantity exceeds issued quantity",
  "Labor cost must be non-negative with at most 2 decimal places",
  "Other direct cost must be non-negative with at most 2 decimal places",
  "Markup percentage must be non-negative with at most 2 decimal places",
  "Costed quantity must be a positive whole number",
];
function business(req: Request, res: Response) {
  return assertRequestedBusiness(
    req,
    res,
    req.body?.businessId ?? req.query.businessId,
  );
}
function error(res: Response, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  return res
    .status(
      bad.includes(message) ||
        message.startsWith("Cannot change production status")
        ? 400
        : 500,
    )
    .json({
      success: false,
      message:
        bad.includes(message) ||
        message.startsWith("Cannot change production status")
          ? message
          : fallback,
    });
}
export async function list(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    res.json({
      success: true,
      data: await service.getBatches(b, {
        ...(typeof req.query.orderId === "string"
          ? { orderId: req.query.orderId }
          : {}),
        ...(typeof req.query.status === "string"
          ? { status: req.query.status }
          : {}),
        ...(typeof req.query.from === "string" ? { from: req.query.from } : {}),
        ...(typeof req.query.to === "string" ? { to: req.query.to } : {}),
      }),
    });
  } catch (e) {
    return error(res, e, "Failed to retrieve production batches");
  }
}
export async function create(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    if (typeof x.orderId !== "string" || !Number.isInteger(x.plannedQuantity))
      return res
        .status(400)
        .json({
          success: false,
          message: "orderId and positive plannedQuantity are required",
        });
    const data = await service.createBatch(b, {
      orderId: x.orderId,
      plannedQuantity: x.plannedQuantity,
      ...(typeof x.orderItemId === "string"
        ? { orderItemId: x.orderItemId }
        : {}),
      ...(typeof x.employeeId === "string" ? { employeeId: x.employeeId } : {}),
      ...(typeof x.startDate === "string" ? { startDate: x.startDate } : {}),
      ...(typeof x.notes === "string" ? { notes: x.notes } : {}),
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to create production batch");
  }
}
export async function detail(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = await service.getBatch(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
    );
    if (!x)
      return res
        .status(404)
        .json({ success: false, message: "Production batch not found" });
    return res.json({ success: true, data: x });
  } catch (e) {
    return error(res, e, "Failed to retrieve production batch");
  }
}
export async function update(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    const data = await service.updateBatch(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
      {
        ...(typeof x.employeeId === "string" || x.employeeId === null
          ? { employeeId: x.employeeId }
          : {}),
        ...(typeof x.notes === "string" || x.notes === null
          ? { notes: x.notes }
          : {}),
        ...(typeof x.startDate === "string" || x.startDate === null
          ? { startDate: x.startDate }
          : {}),
        ...(x.plannedQuantity !== undefined
          ? { plannedQuantity: x.plannedQuantity }
          : {}),
      },
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Production batch not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to update production batch");
  }
}
export async function status(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    if (typeof x.status !== "string")
      return res
        .status(400)
        .json({
          success: false,
          message: "A valid production status is required",
        });
    const data = await service.updateBatchStatus(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
      x.status,
      x.completedQuantity,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Production batch not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to update production status");
  }
}
export async function issue(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    if (typeof x.materialId !== "string" || typeof x.quantity !== "string")
      return res
        .status(400)
        .json({
          success: false,
          message: "materialId and decimal quantity are required",
        });
    const data = await service.issueMaterial(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
      {
        materialId: x.materialId,
        quantity: x.quantity,
        ...(typeof x.employeeId === "string"
          ? { employeeId: x.employeeId }
          : {}),
        ...(typeof x.notes === "string" ? { notes: x.notes } : {}),
      },
    );
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to issue material");
  }
}
export async function usage(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    return res.json({
      success: true,
      data: await service.getUsage(
        b,
        typeof req.params.id === "string" ? req.params.id : "",
      ),
    });
  } catch (e) {
    return error(res, e, "Failed to retrieve material usage");
  }
}
export async function reconcile(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    for (const k of ["consumedQuantity", "wastedQuantity", "returnedQuantity"])
      if (typeof x[k] !== "string")
        return res
          .status(400)
          .json({
            success: false,
            message: `${k} is required as a decimal string`,
          });
    const data = await service.reconcileUsage(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
      typeof req.params.usageId === "string" ? req.params.usageId : "",
      x,
    );
    return res.json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to update material usage");
  }
}
export async function costSheet(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const data = await service.getCostSheet(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
    );
    return data
      ? res.json({ success: true, data })
      : res
          .status(404)
          .json({ success: false, message: "Cost sheet not found" });
  } catch (e) {
    return error(res, e, "Failed to retrieve cost sheet");
  }
}
export async function saveCostSheet(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const x = req.body ?? {};
    if (
      typeof x.laborCost !== "string" ||
      typeof x.otherDirectCost !== "string" ||
      typeof x.markupPercent !== "string" ||
      !Number.isInteger(x.costedQuantity)
    )
      return res
        .status(400)
        .json({
          success: false,
          message:
            "laborCost, otherDirectCost, markupPercent, and costedQuantity are required",
        });
    const data = await service.saveCostSheet(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
      x,
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Production batch not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to save cost sheet");
  }
}
export async function calculate(req: Request, res: Response) {
  try {
    const b = business(req, res);
    if (!b) return;
    const data = await service.calculateCost(
      b,
      typeof req.params.id === "string" ? req.params.id : "",
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Production batch not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return error(res, e, "Failed to calculate production cost");
  }
}
