import { useState } from "react";
import { Plus, RefreshCw, Search, UserRound } from "lucide-react";
import EmployeeForm from "../components/EmployeeForm";
import EmployeesTable from "../components/EmployeesTable";
import { useCreateEmployee, useEmployees } from "../hooks/useEmployees";
import type { CreateEmployeeInput } from "../types/employee.types";
import "./Employees.css";
import { useLanguage } from "../../../app/providers/LanguageProvider";

export default function EmployeesPage() {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const employeesQuery = useEmployees();
  const createEmployee = useCreateEmployee();
  const employees = employeesQuery.data ?? [];

  const filteredEmployees = employees.filter((employee) =>
    `${employee.fullName} ${employee.employeeCode ?? ""} ${employee.phone ?? ""} ${employee.jobTitle ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const errorMessage =
    createEmployee.error instanceof Error
      ? createEmployee.error.message
      : employeesQuery.error instanceof Error
        ? employeesQuery.error.message
        : "";

  function handleCreateEmployee(input: CreateEmployeeInput) {
    createEmployee.mutate(input, { onSuccess: () => setShowForm(false) });
  }

  return (
    <div className="employees-page">
      <div className="employees-heading">
        <div>
          <div className="employees-eyebrow"><UserRound size={14} /> {t("WORKFORCE DIRECTORY")}</div>
          <h1>{t("Employees")}</h1>
          <p>{t("Manage employee profiles and contact information.")}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            createEmployee.reset();
            setShowForm((current) => !current);
          }}>
          <Plus size={18} /> {t("Add employee")}
        </button>
      </div>

      {createEmployee.isSuccess && !showForm && (
        <div className="employee-success" role="status">
          {t("Employee registered successfully.")}
          <button onClick={() => createEmployee.reset()} aria-label={t("Dismiss success message")}>×</button>
        </div>
      )}
      {errorMessage && <div className="employee-error" role="alert">{t(errorMessage)}</div>}

      {showForm && (
        <EmployeeForm
          isSubmitting={createEmployee.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={handleCreateEmployee}
        />
      )}

      <section className="employee-directory" aria-label={t("Employee list")}>
        <div className="employee-directory-heading">
          <div>
            <h2>{t("Employee directory")}</h2>
            <p>{employees.length} {t(employees.length === 1 ? "employee" : "employees")} · {t("includes active and inactive")}</p>
          </div>
          <div className="employee-directory-actions">
            <label className="employee-search">
              <Search size={17} />
              <input
                type="search"
                placeholder={t("Search name, code, phone or job title")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t("Search employees by name, employee code, phone or job title")}
              />
            </label>
            <button
              className="employee-refresh"
              onClick={() => void employeesQuery.refetch()}
              disabled={employeesQuery.isFetching}
              aria-label={t("Refresh employee list")}>
              <RefreshCw size={16} />
              <span>{t(employeesQuery.isFetching ? "Refreshing" : "Refresh")}</span>
            </button>
          </div>
        </div>

        <EmployeesTable employees={filteredEmployees} isLoading={employeesQuery.isLoading} />
        {!employeesQuery.isLoading && employees.length > 0 && (
          <div className="employee-results-count">{t("Showing")} {filteredEmployees.length} {t("of")} {employees.length} {t("employees")}</div>
        )}
      </section>
    </div>
  );
}
