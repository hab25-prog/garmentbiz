import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { BriefcaseBusiness, CalendarDays, Phone, Users } from "lucide-react";
import type { Employee } from "../types/employee.types";
import { formatAppDate } from "../../../app/utils/format-app-date";

interface EmployeesTableProps {
  employees: Employee[];
  isLoading: boolean;
}

function formatHireDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : formatAppDate(date, { dateStyle: "medium", timeZone: "Africa/Addis_Ababa" });
}

function formatMonthlySalary(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "ETB —";
  return `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EmployeesTable({ employees, isLoading }: EmployeesTableProps) {
  return (
    <div className="employee-table-container">
      <table className="employee-table">
        <thead>
          <tr>
            <th><LocalizedText text={"Employee"} /></th>
            <th><LocalizedText text={"Phone"} /></th>
            <th><LocalizedText text={"Position"} /></th>
            <th><LocalizedText text={"Hire date"} /></th>
            <th><LocalizedText text={"Monthly salary "} /><span className="employee-readonly-label"><LocalizedText text={"READ ONLY"} /></span></th>
            <th><LocalizedText text={"Status"} /></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="employee-table-message" role="status"><LocalizedText text={"Loading employees..."} /></td></tr>
          ) : employees.length === 0 ? (
            <tr>
              <td colSpan={6} className="employee-table-message">
                <div className="employee-empty-icon"><Users size={21} /></div>
                <strong><LocalizedText text={"No employees found"} /></strong>
                <span><LocalizedText text={"Try a different search or register an employee."} /></span>
              </td>
            </tr>
          ) : employees.map((employee) => (
            <tr key={employee.id}>
              <td>
                <div className="employee-identity">
                  <span className="employee-avatar" aria-hidden="true">{employee.fullName.trim().charAt(0).toUpperCase()}</span>
                  <div>
                    <strong>{employee.fullName}</strong>
                    <span>{employee.employeeCode || translateCurrent("No employee code")}</span>
                  </div>
                </div>
              </td>
              <td>{employee.phone ? <span className="employee-contact"><Phone size={14} />{employee.phone}</span> : <span className="employee-muted">—</span>}</td>
              <td>{employee.jobTitle ? <span className="employee-contact"><BriefcaseBusiness size={14} />{employee.jobTitle}</span> : <span className="employee-muted">—</span>}</td>
              <td>{employee.hireDate ? <span className="employee-contact"><CalendarDays size={14} />{formatHireDate(employee.hireDate)}</span> : <span className="employee-muted">—</span>}</td>
              <td><span className="employee-salary-readonly">{formatMonthlySalary(employee.monthlySalary)}</span></td>
              <td>
                <span className={`employee-status ${employee.isActive ? "active" : "inactive"}`}>
                  <span />{translateCurrent(employee.isActive ? "Active" : "Inactive")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
