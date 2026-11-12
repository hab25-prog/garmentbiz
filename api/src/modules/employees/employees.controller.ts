import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createEmployee, getEmployees } from "./employees.service.js";

const optionalStringFields = ["employeeCode", "phone", "jobTitle"] as const;

export async function createEmployeeController(req: Request, res: Response) {
  try {
    const { fullName, employeeCode, phone, jobTitle, hireDate } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (typeof fullName !== "string" || !fullName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Employee name is required",
      });
    }

    const optionalFields = { employeeCode, phone, jobTitle };
    for (const field of optionalStringFields) {
      const value = optionalFields[field];
      if (value !== undefined && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          message: `${field} must be a string`,
        });
      }
    }

    let parsedHireDate: Date | undefined;
    if (hireDate !== undefined && hireDate !== null && hireDate !== "") {
      if (typeof hireDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) {
        return res.status(400).json({
          success: false,
          message: "hireDate must be a valid date in YYYY-MM-DD format",
        });
      }

      const dateParts = hireDate.split("-").map(Number);
      const year = dateParts[0];
      const month = dateParts[1];
      const day = dateParts[2];
      if (year === undefined || month === undefined || day === undefined) {
        return res.status(400).json({
          success: false,
          message: "hireDate must be a valid date in YYYY-MM-DD format",
        });
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        return res.status(400).json({
          success: false,
          message: "hireDate must be a valid date in YYYY-MM-DD format",
        });
      }
      parsedHireDate = date;
    }

    const employee = await createEmployee({
      businessId,
      fullName: fullName.trim(),
      ...(employeeCode !== undefined && employeeCode.trim()
        ? { employeeCode: employeeCode.trim() }
        : {}),
      ...(phone !== undefined && phone.trim() ? { phone: phone.trim() } : {}),
      ...(jobTitle !== undefined && jobTitle.trim()
        ? { jobTitle: jobTitle.trim() }
        : {}),
      ...(parsedHireDate !== undefined ? { hireDate: parsedHireDate } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: employee,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Business not found") {
      return res.status(404).json({ success: false, message: error.message });
    }

    if (
      error instanceof Error &&
      error.message === "Employee code already exists for this business"
    ) {
      return res.status(409).json({ success: false, message: error.message });
    }

    console.error("Create employee error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create employee",
    });
  }
}

export async function getEmployeesController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.query.businessId);
    if (!businessId) return;

    const employees = await getEmployees(businessId);
    return res.status(200).json({ success: true, data: employees });
  } catch (error) {
    console.error("Get employees error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve employees",
    });
  }
}
