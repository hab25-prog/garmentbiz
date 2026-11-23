import type { Request, Response } from "express";
import { assertRequestedBusiness, getAuthenticatedBusinessId } from "../../middleware/auth.middleware.js";
import { createUnit, getUnits, initializeDefaultUnits } from "./units.service.js";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function getUnitsController(req: Request, res: Response) {
  const businessId = getAuthenticatedBusinessId(req);
  if (!businessId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    const units = await getUnits(businessId);
    return res.status(200).json({ success: true, data: units });
  } catch (error) {
    console.error("Get units error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve units",
    });
  }
}

export async function createUnitController(req: Request, res: Response) {
  const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
  if (!businessId) return;
  const { name, code } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
    return res.status(400).json({ success: false, message: "Unit name is required and must be 60 characters or fewer" });
  }
  if (typeof code !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,11}$/.test(code.trim())) {
    return res.status(400).json({ success: false, message: "Abbreviation must be 1–12 letters, numbers, or . _ / - characters" });
  }

  try {
    const unit = await createUnit(businessId, { name: name.trim(), code: code.trim() });
    return res.status(201).json({ success: true, message: "Measurement unit created", data: unit });
  } catch (error) {
    if (isUniqueConstraintError(error) || (error instanceof Error && error.message === "A unit with this name or abbreviation already exists")) {
      return res.status(409).json({ success: false, message: "A unit with this name or abbreviation already exists" });
    }
    console.error("Create unit error:", error);
    return res.status(500).json({ success: false, message: "Failed to create measurement unit" });
  }
}

export async function initializeDefaultUnitsController(req: Request, res: Response) {
  const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
  if (!businessId) return;
  try {
    const result = await initializeDefaultUnits(businessId);
    const units = await getUnits(businessId);
    return res.status(200).json({
      success: true,
      message: `${result.addedCount} recommended units added; ${result.alreadyExistedCount} already existed`,
      data: { units, ...result },
    });
  } catch (error) {
    console.error("Initialize measurement units error:", error);
    return res.status(500).json({ success: false, message: "Failed to initialize measurement units" });
  }
}
