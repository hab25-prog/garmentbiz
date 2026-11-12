import type { Request, Response } from "express";
import { getAuthenticatedBusinessId } from "../../middleware/auth.middleware.js";
import { getUnits } from "./units.service.js";

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
