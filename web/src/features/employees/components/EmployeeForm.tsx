import { useState, type FormEvent } from "react";
import type { CreateEmployeeInput } from "../types/employee.types";

interface EmployeeFormProps {
  onSubmit: (input: CreateEmployeeInput) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

export default function EmployeeForm({
  onSubmit,
  isSubmitting,
  onCancel,
}: EmployeeFormProps) {
  const [form, setForm] = useState<CreateEmployeeInput>({
    fullName: "",
    employeeCode: "",
    phone: "",
    jobTitle: "",
    hireDate: "",
  });

  function updateField(field: keyof CreateEmployeeInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      fullName: form.fullName.trim(),
      ...(form.employeeCode?.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
      ...(form.phone?.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.jobTitle?.trim() ? { jobTitle: form.jobTitle.trim() } : {}),
      ...(form.hireDate ? { hireDate: form.hireDate } : {}),
    });
  }

  return (
    <form className="employee-form" onSubmit={handleSubmit}>
      <div className="employee-form-heading">
        <div>
          <h2>Register employee</h2>
          <p>Add an employee to your workshop directory.</p>
        </div>
      </div>

      <div className="employee-form-grid">
        <label>
          Full name <span aria-hidden="true">*</span>
          <input
            autoFocus
            required
            value={form.fullName}
            onChange={(event) => updateField("fullName", event.target.value)}
            placeholder="Enter employee name"
          />
        </label>
        <label>
          Employee code
          <input
            value={form.employeeCode}
            onChange={(event) => updateField("employeeCode", event.target.value)}
            placeholder="e.g. EMP-001"
          />
        </label>
        <label>
          Phone number
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+251..."
          />
        </label>
        <label>
          Job title / position
          <input
            value={form.jobTitle}
            onChange={(event) => updateField("jobTitle", event.target.value)}
            placeholder="e.g. Sewing operator"
          />
        </label>
        <label>
          Hire date
          <input
            type="date"
            value={form.hireDate}
            onChange={(event) => updateField("hireDate", event.target.value)}
          />
        </label>
      </div>

      <div className="employee-form-actions">
        <button
          type="button"
          className="employee-secondary-button"
          onClick={onCancel}
          disabled={isSubmitting}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !form.fullName.trim()}>
          {isSubmitting ? "Saving..." : "Save employee"}
        </button>
      </div>
    </form>
  );
}
