import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { X } from "lucide-react";
import { normalizeExpenseCreateRequest, readPendingExpenseCreates } from "../utils/expense-retry-storage";
import type { CreateExpenseFields, ExpenseCategory, ExpenseDetail, ExpensePaymentMethod, UpdateExpenseRequest } from "../types/expense.types";
import type { Employee } from "../../employees/types/employee.types";

interface ExpenseFormProps {
  mode?: "create" | "edit";
  expense?: ExpenseDetail;
  returnFocusRef?: RefObject<HTMLElement | null>;
  businessId?: string;
  employees: Employee[];
  employeesLoading: boolean;
  employeesError: boolean;
  onRetryEmployees: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  retryInput: CreateExpenseFields | null;
  onSubmit: (input: CreateExpenseFields) => void;
  onUpdate?: (input: UpdateExpenseRequest) => void;
  onCancel: () => void;
}

interface ExpenseFormValues {
  category: ExpenseCategory;
  paymentMethod: ExpensePaymentMethod | "";
  description: string;
  amount: string;
  expenseDate: string;
  periodMonth: string;
  employeeId: string;
  reference: string;
  notes: string;
}

function addisAbabaToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function initialValues(): ExpenseFormValues {
  return {
    category: "OTHER",
    paymentMethod: "CASH",
    description: "",
    amount: "",
    expenseDate: addisAbabaToday(),
    periodMonth: "",
    employeeId: "",
    reference: "",
    notes: "",
  };
}

function dateInAddisAbaba(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthInAddisAbaba(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function valuesForExpense(expense: ExpenseDetail): ExpenseFormValues {
  return {
    category: expense.category,
    paymentMethod: expense.paymentMethod ?? "",
    description: expense.description,
    amount: expense.amount,
    expenseDate: dateInAddisAbaba(expense.expenseDate),
    periodMonth: monthInAddisAbaba(expense.periodMonth),
    employeeId: expense.employeeId ?? "",
    reference: expense.reference ?? "",
    notes: expense.notes ?? "",
  };
}

function positiveDecimal(value: string): boolean {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(normalized)) return false;
  const [whole, fraction = ""] = normalized.split(".");
  return whole !== "0" || /[1-9]/.test(fraction);
}

function toCreateFields(values: ExpenseFormValues): CreateExpenseFields {
  return {
    category: values.category,
    paymentMethod: values.paymentMethod as ExpensePaymentMethod,
    description: values.description,
    amount: values.amount,
    expenseDate: values.expenseDate,
    ...(values.periodMonth ? { periodMonth: values.periodMonth } : {}),
    employeeId: values.employeeId || null,
    reference: values.reference || null,
    notes: values.notes || null,
  };
}

function toUpdateFields(values: ExpenseFormValues, original: ExpenseDetail, reason: string): UpdateExpenseRequest | null {
  const initial = valuesForExpense(original);
  const patch: Omit<UpdateExpenseRequest, "reason"> = {};
  (Object.keys(values) as Array<keyof ExpenseFormValues>).forEach((key) => {
    if (values[key] === initial[key]) return;
    switch (key) {
      case "category": patch.category = values.category; break;
      case "paymentMethod": if (values.paymentMethod) patch.paymentMethod = values.paymentMethod; break;
      case "description": patch.description = values.description; break;
      case "amount": patch.amount = values.amount; break;
      case "expenseDate": patch.expenseDate = values.expenseDate; break;
      case "periodMonth": patch.periodMonth = values.periodMonth || null; break;
      case "employeeId": patch.employeeId = values.employeeId || null; break;
      case "reference": patch.reference = values.reference || null; break;
      case "notes": patch.notes = values.notes || null; break;
    }
  });
  if (Object.keys(patch).length === 0) return null;
  // Keep an unchanged accounting month omitted. The backend then preserves it,
  // or derives a new one if expenseDate changed. An explicitly cleared month is null.
  if (values.periodMonth === initial.periodMonth) delete patch.periodMonth;
  return { ...patch, reason: reason.trim() };
}

function sameNormalizedRequest(left: CreateExpenseFields, right: CreateExpenseFields): boolean {
  const normalizedLeft = normalizeExpenseCreateRequest(left);
  const normalizedRight = normalizeExpenseCreateRequest(right);
  return normalizedLeft !== null && normalizedRight !== null &&
    JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export default function ExpenseForm({
  mode = "create",
  expense,
  returnFocusRef,
  businessId,
  employees,
  employeesLoading,
  employeesError,
  onRetryEmployees,
  isSubmitting,
  errorMessage,
  retryInput,
  onSubmit,
  onUpdate,
  onCancel,
}: ExpenseFormProps) {
  const editing = mode === "edit" && expense !== undefined;
  const [values, setValues] = useState<ExpenseFormValues>(() => editing ? valuesForExpense(expense) : initialValues());
  const [reason, setReason] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const isSubmittingRef = useRef(isSubmitting);
  const onCancelRef = useRef(onCancel);
  const [pendingResult] = useState(() => editing
    ? { ok: true as const, pending: [] }
    : readPendingExpenseCreates(businessId ?? ""));
  const retryingSameRequest = useMemo(
    () => retryInput !== null && sameNormalizedRequest(toCreateFields(values), retryInput),
    [retryInput, values],
  );

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
    onCancelRef.current = onCancel;
  }, [isSubmitting, onCancel]);

  useEffect(() => {
    if (editing) return;
    const dialog = dialogRef.current;
    const opener = returnFocusRef?.current;
    dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isSubmittingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [editing, returnFocusRef]);

  function update<K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setValidationMessage(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!positiveDecimal(values.amount)) {
      setValidationMessage("Enter an amount greater than zero with no more than two decimal places.");
      return;
    }
    if (!values.description.trim()) {
      setValidationMessage("Description is required.");
      return;
    }
    if (!values.paymentMethod) {
      setValidationMessage("Select a payment method.");
      return;
    }
    if (!pendingResult.ok) {
      setValidationMessage(pendingResult.error === "storage-unavailable"
        ? "Secure retry storage is unavailable. Submission was not sent."
        : "Saved retry information could not be read. Submission was not sent to avoid a possible duplicate.");
      return;
    }
    if (editing && expense && onUpdate) {
      if (!reason.trim()) {
        setValidationMessage("An edit reason is required.");
        return;
      }
      const update = toUpdateFields(values, expense, reason);
      if (!update) {
        setValidationMessage("Change at least one expense field before saving.");
        return;
      }
      onUpdate(update);
      return;
    }
    onSubmit(toCreateFields(values));
  }

  const formContent = (
    <section
      className="expense-create-dialog"
      {...(!editing ? { role: "dialog", "aria-modal": true, "aria-describedby": "expense-create-description" } : {})}
      aria-labelledby="expense-create-title"
      ref={!editing ? dialogRef : undefined}
      tabIndex={!editing ? -1 : undefined}>
      <header className="expense-form-heading">
        <div>
          <span className="expenses-eyebrow">{translateCurrent(editing ? "EDIT EXPENSE" : "NEW BUSINESS EXPENSE")}</span>
          <h2 id="expense-create-title">{translateCurrent(editing ? "Edit expense" : "Record an expense")}</h2>
          <p id="expense-create-description">{translateCurrent(editing ? "Changes are recorded in the expense audit history." : "Enter money already paid or spent. This creates a permanent expense record.")}</p>
        </div>
        <button className="expense-dialog-close" type="button" onClick={onCancel} disabled={isSubmitting} aria-label={editing ? "Cancel expense editing" : "Close expense form"} data-dialog-initial-focus={!editing ? true : undefined}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {!editing && retryInput ? (
        <div className="expense-retry-notice" role="status">
          {translateCurrent(retryingSameRequest
            ? "The previous request may not have received confirmation. Retrying these same details reuses its saved key."
            : "An earlier request may not have received confirmation. Re-enter any previously submitted identical details to reuse its key; changed details use a separate key and do not remove earlier requests.")}
        </div>
      ) : !editing && pendingResult.ok && pendingResult.pending.length > 0 && (
        <div className="expense-retry-notice" role="status">
          {`${pendingResult.pending.length} earlier expense submission${pendingResult.pending.length === 1 ? " may" : "s may"} still need confirmation. Matching details reuse the saved key; other requests keep their own keys.`}
        </div>
      )}
      {!editing && !pendingResult.ok && (
        <div className="expense-form-error" role="alert">
          {translateCurrent(pendingResult.error === "storage-unavailable"
            ? "Secure retry storage is unavailable. Expense submission is blocked until this browser session can use session storage."
            : "Saved retry information could not be read. Submission is blocked to avoid creating a duplicate expense.")}
        </div>
      )}
      {errorMessage && <div className="expense-form-error" role="alert">{translateCurrent(errorMessage)}</div>}
      {validationMessage && <div className="expense-form-error" role="alert">{validationMessage}</div>}

      <form className="expense-create-form" onSubmit={submit} noValidate>
        <div className="expense-create-grid">
          <label>
            <LocalizedText text={"\n            Category "} /><span aria-hidden="true">*</span>
            <select value={values.category} onChange={(event) => update("category", event.target.value as ExpenseCategory)} required>
              <option value="SALARY"><LocalizedText text={"Salary"} /></option><option value="RENT"><LocalizedText text={"Rent"} /></option><option value="UTILITIES"><LocalizedText text={"Utilities"} /></option><option value="TRANSPORT"><LocalizedText text={"Transport"} /></option><option value="MAINTENANCE"><LocalizedText text={"Maintenance"} /></option><option value="SUPPLIES"><LocalizedText text={"Supplies"} /></option><option value="OTHER"><LocalizedText text={"Other"} /></option>
            </select>
          </label>
          <label>
            <LocalizedText text={"\n            Payment method "} /><span aria-hidden="true">*</span>
            <select value={values.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value as ExpensePaymentMethod | "")} required>
              {editing && !values.paymentMethod && <option value=""><LocalizedText text={"Not recorded (legacy)"} /></option>}
              <option value="CASH"><LocalizedText text={"Cash"} /></option><option value="BANK_TRANSFER"><LocalizedText text={"Bank transfer"} /></option><option value="MOBILE_MONEY"><LocalizedText text={"Mobile money"} /></option><option value="CARD"><LocalizedText text={"Card"} /></option><option value="OTHER"><LocalizedText text={"Other"} /></option>
            </select>
          </label>
          <label className="expense-form-wide">
            <LocalizedText text={"\n            Description "} /><span aria-hidden="true">*</span>
            <input autoFocus value={values.description} onChange={(event) => update("description", event.target.value)} maxLength={500} required placeholder={translateCurrent("What was the payment or spending for?")} />
          </label>
          <label>
            <LocalizedText text={"\n            Amount (ETB) "} /><span aria-hidden="true">*</span>
            <input type="text" inputMode="decimal" autoComplete="off" value={values.amount} onChange={(event) => update("amount", event.target.value)} aria-describedby="expense-amount-help" required placeholder="0.00" />
            <small id="expense-amount-help"><LocalizedText text={"Positive amount, up to two decimal places."} /></small>
          </label>
          <label>
            <LocalizedText text={"\n            Expense date "} /><span aria-hidden="true">*</span>
            <input type="date" value={values.expenseDate} onChange={(event) => update("expenseDate", event.target.value)} required />
          </label>
          <label>
            <LocalizedText text={"\n            Accounting month\n            "} /><input type="month" value={values.periodMonth} onChange={(event) => update("periodMonth", event.target.value)} />
            <small>{translateCurrent(editing ? "If both the expense date and month stay unchanged, the existing month is preserved. If the date changes and the month stays unchanged, the backend derives the month from the new date. Choose a different month to set it explicitly, or clear it to derive from the expense date." : "Leave blank to use the expense date's month.")}</small>
          </label>
          <label>
            <LocalizedText text={"\n            Employee "} /><span className="expense-optional-label"><LocalizedText text={"(optional)"} /></span>
            <select value={values.employeeId} onChange={(event) => update("employeeId", event.target.value)} disabled={employeesLoading || employeesError}>
              <option value=""><LocalizedText text={"No employee"} /></option>
              {editing && expense?.employee && !employees.some((employee) => employee.id === expense.employeeId) && <option value={expense.employee.id}>{expense.employee.fullName}{translateCurrent(expense.employee.isActive ? "" : " (inactive)")}</option>}
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}{employee.employeeCode ? ` · ${employee.employeeCode}` : ""}{translateCurrent(employee.isActive ? "" : " (inactive)")}</option>)}
            </select>
            {employeesLoading && <small><LocalizedText text={"Loading employees…"} /></small>}
            {employeesError && <small className="expense-field-error"><LocalizedText text={"Employee list unavailable. "} /><button type="button" onClick={onRetryEmployees}><LocalizedText text={"Retry"} /></button></small>}
            {!employeesLoading && !employeesError && employees.length === 0 && <small><LocalizedText text={"No employees are available; you can leave this blank."} /></small>}
          </label>
          <label>
            <LocalizedText text={"\n            Reference "} /><span className="expense-optional-label"><LocalizedText text={"(optional)"} /></span>
            <input value={values.reference} onChange={(event) => update("reference", event.target.value)} maxLength={128} />
          </label>
          <label className="expense-form-wide">
            <LocalizedText text={"\n            Notes "} /><span className="expense-optional-label"><LocalizedText text={"(optional)"} /></span>
            <textarea value={values.notes} onChange={(event) => update("notes", event.target.value)} maxLength={2000} rows={3} />
          </label>
          {editing && <label className="expense-form-wide"><LocalizedText text={"Reason for this edit "} /><span aria-hidden="true">*</span><textarea value={reason} onChange={(event) => { setReason(event.target.value); setValidationMessage(null); }} maxLength={1000} rows={2} required /></label>}
        </div>
        <div className="expense-form-actions">
          <button type="button" className="expense-form-secondary" onClick={onCancel} disabled={isSubmitting}><LocalizedText text={"Cancel"} /></button>
          <button type="submit" className="expense-form-submit" disabled={isSubmitting || (!editing && !pendingResult.ok)}>
            {translateCurrent(isSubmitting ? (editing ? "Saving changes…" : "Saving expense…") : editing ? "Save changes" : retryingSameRequest ? "Retry same submission" : pendingResult.ok && pendingResult.pending.length > 0 ? "Submit / retry expense" : "Save expense")}
          </button>
        </div>
      </form>
    </section>
  );

  return editing ? <div className="expense-edit-inline">{formContent}</div> : (
    <div
      className="expense-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onCancel();
      }}>
      {formContent}
    </div>
  );
}
