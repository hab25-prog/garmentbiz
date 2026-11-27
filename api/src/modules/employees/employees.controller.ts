import type { Request, Response } from "express";
import { assertRequestedBusiness } from "../../middleware/auth.middleware.js";
import { createEmployee, getEmployees, updateEmployee } from "./employees.service.js";
import { isValidInvitationEmail } from "./employee-invitations.service.js";
import {
  createEmployeeInvitation,
  EmployeeInvitationError,
  type InvitationDeliveryResult,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
} from "./employee-invitations.service.js";
import { isMembershipRole } from "../../authorization/permissions.js";
import { acceptEmployeeInvitation } from "./employee-invitation-acceptance.service.js";

const optionalStringFields = ["employeeCode", "phone", "jobTitle"] as const;

function invitationEmployeeId(req: Request): string | undefined {
  const value = req.params.employeeId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invitationActor(req: Request) {
  const principal = req.businessPrincipal;
  return principal
    ? { businessId: principal.businessId, membershipId: principal.membershipId, userId: principal.userId }
    : undefined;
}

function invitationFailure(res: Response, error: unknown, operation: string) {
  if (error instanceof EmployeeInvitationError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  // Do not log request bodies, email addresses, or raw invitation tokens.
  console.error(`Employee invitation ${operation} failed`);
  return res.status(500).json({ success: false, message: "Unable to complete the employee invitation request" });
}

function invitationSuccessMessage(result: InvitationDeliveryResult, action: "created" | "resent") {
  switch (result.deliveryStatus) {
    case "SMTP_ACCEPTED_RECORDED":
      return `Invitation ${action}. SMTP accepted the message and the acceptance timestamp was recorded; delivery is not guaranteed.`;
    case "SMTP_ACCEPTED_UNRECORDED":
      return `SMTP accepted the invitation, but the acceptance timestamp could not be saved. No automatic resend was attempted.`;
    case "SMTP_NOT_ACCEPTED":
      return `Invitation ${action}, but SMTP did not confirm acceptance. An authorized user may explicitly resend it.`;
    case "NOT_SENT_CHANGED":
      return "The invitation or employee changed before email sending. No email was sent.";
    case "NOT_SENT_CHECK_FAILED":
      return "The invitation was created, but its current state could not be verified. No email was sent.";
  }
}

function invitationDeliveryData(result: InvitationDeliveryResult) {
  return {
    invitation: result.invitation,
    smtpAccepted: result.smtpAccepted,
    smtpAcceptedAtPersisted: result.smtpAcceptedAtPersisted,
    deliveryStatus: result.deliveryStatus,
  };
}

export function createEmployeeInvitationControllerWith(
  createInvitation: typeof createEmployeeInvitation = createEmployeeInvitation,
) {
  return async function createEmployeeInvitationHandler(req: Request, res: Response) {
    const employeeId = invitationEmployeeId(req);
    const actor = invitationActor(req);
    if (!employeeId) return res.status(400).json({ success: false, message: "Employee ID is required" });
    if (!actor) return res.status(401).json({ success: false, message: "Authentication required" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "role")) {
      return res.status(400).json({ success: false, message: "Request body must contain only a role" });
    }
    if (!isMembershipRole(body.role)) return res.status(400).json({ success: false, message: "A valid invitation role is required" });
    try {
      const result = await createInvitation(actor, employeeId, body.role);
      return res.status(201).json({
        success: true,
        message: invitationSuccessMessage(result, "created"),
        data: invitationDeliveryData(result),
      });
    } catch (error) {
      return invitationFailure(res, error, "creation");
    }
  };
}

export const createEmployeeInvitationController = createEmployeeInvitationControllerWith();

export async function resendEmployeeInvitationController(req: Request, res: Response) {
  const employeeId = invitationEmployeeId(req);
  const actor = invitationActor(req);
  if (!employeeId) return res.status(400).json({ success: false, message: "Employee ID is required" });
  if (!actor) return res.status(401).json({ success: false, message: "Authentication required" });
  if (req.body !== undefined && (typeof req.body !== "object" || req.body === null || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
    return res.status(400).json({ success: false, message: "Resend does not accept request fields" });
  }
  try {
    const result = await resendEmployeeInvitation(actor, employeeId);
    return res.status(200).json({
      success: true,
      message: invitationSuccessMessage(result, "resent"),
      data: invitationDeliveryData(result),
    });
  } catch (error) {
    return invitationFailure(res, error, "resend");
  }
}

export async function revokeEmployeeInvitationController(req: Request, res: Response) {
  const employeeId = invitationEmployeeId(req);
  const actor = invitationActor(req);
  if (!employeeId) return res.status(400).json({ success: false, message: "Employee ID is required" });
  if (!actor) return res.status(401).json({ success: false, message: "Authentication required" });
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "invitationId") || typeof body.invitationId !== "string" || !body.invitationId.trim()) {
    return res.status(400).json({ success: false, message: "invitationId is required" });
  }
  try {
    const invitation = await revokeEmployeeInvitation(actor, employeeId, body.invitationId.trim());
    return res.status(200).json({ success: true, message: "Invitation revoked", data: invitation });
  } catch (error) {
    return invitationFailure(res, error, "revocation");
  }
}

export async function acceptEmployeeInvitationController(req: Request, res: Response) {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "token" && key !== "password") ||
    typeof body.token !== "string" ||
    typeof body.password !== "string"
  ) {
    return res.status(400).json({ success: false, message: "A token and password are required" });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    return res.status(400).json({ success: false, message: "This invitation link is invalid" });
  }
  if (body.password.length < 12 || body.password.length > 128) {
    return res.status(400).json({ success: false, message: "Password must be between 12 and 128 characters" });
  }

  try {
    await acceptEmployeeInvitation(body.token, body.password);
    return res.status(200).json({
      success: true,
      message: "Invitation accepted. Email verification is required before signing in when this account is not already verified.",
      data: { accepted: true },
    });
  } catch (error) {
    if (error instanceof EmployeeInvitationError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    // Do not include the request body, invitation token, email, or password in logs.
    console.error("Employee invitation acceptance failed");
    return res.status(500).json({ success: false, message: "Unable to accept this invitation right now" });
  }
}

function validSalary(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return false;
  const [whole = "", fraction = ""] = value.split(".");
  return whole.length <= 10 && fraction.length <= 2;
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
    ? date
    : undefined;
}

export async function createEmployeeController(req: Request, res: Response) {
  try {
    const { fullName, email, employeeCode, phone, jobTitle, hireDate, monthlySalary } = req.body ?? {};
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;

    if (typeof fullName !== "string" || !fullName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Employee name is required",
      });
    }

    let normalizedEmail: string | undefined;
    if (email !== undefined) {
      if (typeof email !== "string") return res.status(400).json({ success: false, message: "email must be a valid email address" });
      if (email.trim()) {
        normalizedEmail = email.trim().toLowerCase();
        if (!isValidInvitationEmail(normalizedEmail)) return res.status(400).json({ success: false, message: "email must be a valid email address" });
      }
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
    if (monthlySalary !== undefined && !validSalary(monthlySalary)) {
      return res.status(400).json({ success: false, message: "monthlySalary must be a non-negative decimal string with at most 2 decimal places" });
    }

    const employee = await createEmployee({
      businessId,
      fullName: fullName.trim(),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(employeeCode !== undefined && employeeCode.trim()
        ? { employeeCode: employeeCode.trim() }
        : {}),
      ...(phone !== undefined && phone.trim() ? { phone: phone.trim() } : {}),
      ...(jobTitle !== undefined && jobTitle.trim()
        ? { jobTitle: jobTitle.trim() }
        : {}),
      ...(parsedHireDate !== undefined ? { hireDate: parsedHireDate } : {}),
      ...(monthlySalary !== undefined ? { monthlySalary } : {}),
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

    if (error instanceof Error && [
      "Employee code already exists for this business",
      "Employee email already exists for this business",
    ].includes(error.message)) {
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

    const role = req.businessPrincipal?.role;
    const employees = await getEmployees(businessId, role === "OWNER" || role === "ADMIN");
    return res.status(200).json({ success: true, data: employees });
  } catch (error) {
    console.error("Get employees error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve employees",
    });
  }
}

export async function updateEmployeeController(req: Request, res: Response) {
  try {
    const businessId = assertRequestedBusiness(req, res, req.body?.businessId);
    if (!businessId) return;
    const employeeId = req.params.employeeId;
    if (typeof employeeId !== "string" || !employeeId.trim()) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }
    const body = req.body ?? {};
    const update: Parameters<typeof updateEmployee>[2] = {};
    if (body.fullName !== undefined) {
      if (typeof body.fullName !== "string" || !body.fullName.trim()) return res.status(400).json({ success: false, message: "Employee name cannot be empty" });
      update.fullName = body.fullName.trim();
    }
    if (body.email !== undefined) {
      if (body.email === null || (typeof body.email === "string" && !body.email.trim())) {
        update.email = null;
      } else if (typeof body.email === "string") {
        const normalizedEmail = body.email.trim().toLowerCase();
        if (!isValidInvitationEmail(normalizedEmail)) return res.status(400).json({ success: false, message: "email must be a valid email address or null" });
        update.email = normalizedEmail;
      } else {
        return res.status(400).json({ success: false, message: "email must be a valid email address or null" });
      }
    }
    for (const field of optionalStringFields) {
      const value = body[field];
      if (value !== undefined && value !== null && typeof value !== "string") return res.status(400).json({ success: false, message: `${field} must be a string` });
      if (value !== undefined) update[field] = typeof value === "string" ? value.trim() || null : null;
    }
    if (body.hireDate !== undefined) {
      const parsed = parseDate(body.hireDate);
      if (parsed === undefined) return res.status(400).json({ success: false, message: "hireDate must be a valid date in YYYY-MM-DD format or null" });
      update.hireDate = parsed;
    }
    if (body.monthlySalary !== undefined) {
      if (!validSalary(body.monthlySalary)) return res.status(400).json({ success: false, message: "monthlySalary must be a non-negative decimal string with at most 2 decimal places" });
      update.monthlySalary = body.monthlySalary;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return res.status(400).json({ success: false, message: "isActive must be a boolean" });
      update.isActive = body.isActive;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: "At least one employee field must be provided" });
    const principal = req.businessPrincipal;
    const actor = principal
      ? { businessId: principal.businessId, membershipId: principal.membershipId, userId: principal.userId }
      : undefined;
    const employee = await updateEmployee(businessId, employeeId, update, actor);
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found" });
    return res.json({ success: true, data: employee });
  } catch (error) {
    if (error instanceof EmployeeInvitationError) return res.status(error.status).json({ success: false, message: error.message });
    if (error instanceof Error && [
      "Employee code already exists for this business",
      "Employee email already exists for this business",
    ].includes(error.message)) return res.status(409).json({ success: false, message: error.message });
    console.error("Update employee error:", error);
    return res.status(500).json({ success: false, message: "Failed to update employee" });
  }
}
