import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Pencil, RefreshCw, X } from "lucide-react";
import { useExpense, useUpdateExpense, useVoidExpense } from "../hooks/useExpenses";
import type { ExpenseAuditSnapshot } from "../types/expense.types";
import type { Employee } from "../../employees/types/employee.types";
import ExpenseForm from "./ExpenseForm";

interface ExpenseDetailDialogProps {
  expenseId: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  canManage: boolean;
  employees: Employee[];
  employeesLoading: boolean;
  employeesError: boolean;
  onRetryEmployees: () => void;
  onClose: () => void;
}

const snapshotFields: Array<[keyof ExpenseAuditSnapshot, string]> = [
  ["category", "Category"],
  ["paymentMethod", "Payment method"],
  ["description", "Description"],
  ["amount", "Amount"],
  ["expenseDate", "Expense date"],
  ["periodMonth", "Accounting month"],
  ["employeeId", "Employee ID"],
  ["reference", "Reference"],
  ["notes", "Notes"],
  ["voidedAt", "Voided at"],
  ["voidReason", "Void reason"],
];

function humanize(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "ETB —";
  const [, sign, whole, fraction = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `ETB ${sign}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function formatDate(value: string | null, includeTime = false): string {
  if (!value) return "—";
  if (!includeTime && /^\d{4}-\d{2}$/.test(value)) {
    return formatAppDate(new Date(`${value}-01T12:00:00Z`), {
      month: "long",
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    });
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return formatAppDate(date, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Africa/Addis_Ababa",
  });
}

function formatAccountingMonth(value: string | null): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return formatAppDate(date, { month: "long", year: "numeric", timeZone: "Africa/Addis_Ababa" });
}

function formatValue(field: keyof ExpenseAuditSnapshot, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "amount" && typeof value === "string") return formatMoney(value);
  if ((field === "category" || field === "paymentMethod") && typeof value === "string") return humanize(value);
  if (field === "expenseDate" && typeof value === "string") return formatDate(value);
  if (field === "periodMonth" && typeof value === "string") return formatAccountingMonth(value);
  if (field === "voidedAt" && typeof value === "string") return formatDate(value, true);
  return String(value);
}

function changedFields(previous: ExpenseAuditSnapshot | null, next: ExpenseAuditSnapshot) {
  if (!previous) return [];
  return snapshotFields.filter(([field]) => previous[field] !== next[field]);
}

export default function ExpenseDetailDialog({ expenseId, returnFocusRef, canManage, employees, employeesLoading, employeesError, onRetryEmployees, onClose }: ExpenseDetailDialogProps) {
  const query = useExpense(expenseId);
  const updateExpense = useUpdateExpense();
  const voidExpense = useVoidExpense();
  const dialogRef = useRef<HTMLElement>(null);
  const editActionRef = useRef<HTMLButtonElement>(null);
  const mutationPendingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const data = query.data;

  useEffect(() => {
    mutationPendingRef.current = updateExpense.isPending || voidExpense.isPending;
  }, [updateExpense.isPending, voidExpense.isPending]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = returnFocusRef.current;
    dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (mutationPendingRef.current) return;
        event.preventDefault();
        onClose();
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
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose, returnFocusRef]);

  async function submitUpdate(input: Parameters<typeof updateExpense.mutateAsync>[0]["input"]) {
    setMutationError(null);
    setSuccessMessage(null);
    try {
      await updateExpense.mutateAsync({ expenseId, input });
      setEditing(false);
      setSuccessMessage("Expense updated. The audit history below reflects the saved change.");
      window.requestAnimationFrame(() => editActionRef.current?.focus());
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Expense changes could not be saved. Please retry.");
    }
  }

  async function submitVoid() {
    const reason = voidReason.trim();
    if (!reason) {
      setMutationError("A reason is required to void this expense.");
      return;
    }
    setMutationError(null);
    setSuccessMessage(null);
    try {
      await voidExpense.mutateAsync({ expenseId, input: { reason } });
      setConfirmingVoid(false);
      setVoidReason("");
      setSuccessMessage("Expense voided. The audit history below reflects the saved action.");
      window.requestAnimationFrame(() => dialogRef.current?.focus());
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Expense could not be voided. Please retry.");
    }
  }

  const auditHistory = data ? [...data.auditLogs].sort((left, right) => {
    const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  }) : [];

  return (
    <div
      className="expense-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !mutationPendingRef.current) onClose();
      }}>
      <section
        className="expense-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-detail-title"
        aria-describedby="expense-detail-description"
        ref={dialogRef}
        tabIndex={-1}>
        <header className="expense-detail-heading">
          <div>
            <span className="expenses-eyebrow"><LocalizedText text={"EXPENSE RECORD"} /></span>
      <h2 id="expense-detail-title">{data?.description ?? translateCurrent("Expense details")}</h2>
            <p id="expense-detail-description"><LocalizedText text={"Details and audit history for this business expense."} /></p>
          </div>
          <button className="expense-dialog-close" type="button" onClick={onClose} disabled={updateExpense.isPending || voidExpense.isPending} aria-label={translateCurrent("Close expense details")} data-dialog-initial-focus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {query.isLoading && <p className="expense-detail-state" role="status"><LocalizedText text={"Loading expense details…"} /></p>}
        {query.isError && !data && (
          <div className="expense-detail-error" role="alert">
            <p>{translateCurrent(query.error instanceof Error ? query.error.message : "Expense details could not be loaded.")}</p>
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {translateCurrent(query.isFetching ? "Retrying…" : "Retry")}
            </button>
          </div>
        )}
        {query.isError && data && (
          <div className="expense-detail-error" role="alert">
            <p><LocalizedText text={"The latest details could not be refreshed. The information below may be out of date."} /></p>
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}><LocalizedText text={"Retry"} /></button>
          </div>
        )}
        {query.isFetching && data && <p className="expense-detail-refreshing" role="status"><LocalizedText text={"Refreshing latest details…"} /></p>}

        {data && (
          <div className="expense-detail-content">
            {successMessage && <p className="expense-mutation-success" role="status">{translateCurrent(successMessage)}</p>}
            {mutationError && <div className="expense-detail-error" role="alert"><p>{translateCurrent(mutationError)}</p></div>}
            {canManage && !data.voidedAt && !editing && (
              <div className="expense-management-actions">
                <button ref={editActionRef} type="button" className="expense-edit-action" onClick={() => { setMutationError(null); setSuccessMessage(null); setEditing(true); }} disabled={query.isFetching || query.isError || updateExpense.isPending || voidExpense.isPending}>
                  <Pencil size={15} aria-hidden="true" /> <LocalizedText text={" Edit expense\n                "} /></button>
                <button type="button" className="expense-void-action" onClick={() => { setMutationError(null); setSuccessMessage(null); setConfirmingVoid(true); }} disabled={query.isFetching || query.isError || updateExpense.isPending || voidExpense.isPending}><LocalizedText text={"Void expense"} /></button>
              </div>
            )}
            {editing && canManage && !data.voidedAt ? (
              <ExpenseForm
                key={`edit-${data.id}-${data.updatedAt}`}
                mode="edit"
                expense={data}
                employees={employees}
                employeesLoading={employeesLoading}
                employeesError={employeesError}
                onRetryEmployees={onRetryEmployees}
                isSubmitting={updateExpense.isPending}
                errorMessage={mutationError}
                retryInput={null}
                onSubmit={() => undefined}
                onUpdate={(input) => void submitUpdate(input)}
                onCancel={() => { if (!updateExpense.isPending) { setEditing(false); setMutationError(null); window.requestAnimationFrame(() => editActionRef.current?.focus()); } }}
              />
            ) : (
            <>
            <section className="expense-detail-overview" aria-labelledby="expense-overview-title">
              <div className="expense-detail-overview-heading">
                <h3 id="expense-overview-title"><LocalizedText text={"Expense information"} /></h3>
                <span className={`expense-status ${data.voidedAt ? "voided" : "recorded"}`}>{translateCurrent(data.voidedAt ? "Voided" : "Active")}</span>
              </div>
              <dl className="expense-detail-grid">
                <div className="expense-detail-amount"><dt><LocalizedText text={"Amount"} /></dt><dd>{formatMoney(data.amount)}</dd></div>
                <div><dt><LocalizedText text={"Category"} /></dt><dd>{translateCurrent(humanize(data.category))}</dd></div>
                <div><dt><LocalizedText text={"Payment method"} /></dt><dd>{translateCurrent(data.paymentMethod ? humanize(data.paymentMethod) : "Not recorded")}</dd></div>
                <div><dt><LocalizedText text={"Expense date"} /></dt><dd>{formatDate(data.expenseDate)}</dd></div>
                <div><dt><LocalizedText text={"Accounting month"} /></dt><dd>{formatAccountingMonth(data.periodMonth)}</dd></div>
                <div><dt><LocalizedText text={"Employee"} /></dt><dd>{data.employee?.fullName ?? "—"}</dd></div>
                <div><dt><LocalizedText text={"Reference"} /></dt><dd>{data.reference ?? "—"}</dd></div>
                <div className="expense-detail-wide"><dt><LocalizedText text={"Notes"} /></dt><dd>{data.notes ?? "—"}</dd></div>
                <div><dt><LocalizedText text={"Created"} /></dt><dd>{formatDate(data.createdAt, true)}</dd></div>
                <div><dt><LocalizedText text={"Last updated"} /></dt><dd>{formatDate(data.updatedAt, true)}</dd></div>
              </dl>
            </section>

            {data.voidedAt && (
              <section className="expense-void-details" aria-labelledby="expense-void-title">
                <h3 id="expense-void-title"><LocalizedText text={"Void information"} /></h3>
                <dl>
                  <div><dt><LocalizedText text={"Reason"} /></dt><dd>{data.voidReason || "—"}</dd></div>
                  <div><dt><LocalizedText text={"Voided at"} /></dt><dd>{formatDate(data.voidedAt, true)}</dd></div>
                  <div><dt><LocalizedText text={"Voided by"} /></dt><dd>{translateCurrent(auditHistory.find((entry) => entry.action === "VOIDED")?.actorNameSnapshot ?? "Not available")}</dd></div>
                </dl>
              </section>
            )}

            {confirmingVoid && canManage && !data.voidedAt && (
              <section className="expense-void-confirm" aria-labelledby="expense-void-confirm-title">
                <h3 id="expense-void-confirm-title"><LocalizedText text={"Confirm void"} /></h3>
                <p><LocalizedText text={"This keeps the expense record and records a void audit entry. It cannot be edited or voided again."} /></p>
                <label htmlFor="expense-void-reason"><LocalizedText text={"Reason for voiding "} /><span aria-hidden="true">*</span></label>
                <textarea id="expense-void-reason" autoFocus value={voidReason} onChange={(event) => { setVoidReason(event.target.value); setMutationError(null); }} maxLength={1000} rows={3} required disabled={voidExpense.isPending} />
                <div className="expense-form-actions">
                  <button type="button" className="expense-form-secondary" onClick={() => { setConfirmingVoid(false); setVoidReason(""); setMutationError(null); }} disabled={voidExpense.isPending}><LocalizedText text={"Cancel"} /></button>
                  <button type="button" className="expense-void-action" onClick={() => void submitVoid()} disabled={voidExpense.isPending || !voidReason.trim()}>{translateCurrent(voidExpense.isPending ? "Voiding…" : "Confirm void")}</button>
                </div>
              </section>
            )}

            <section className="expense-audit-section" aria-labelledby="expense-audit-title">
              <div className="expense-audit-heading">
                <div><h3 id="expense-audit-title"><LocalizedText text={"Audit history"} /></h3><p><LocalizedText text={"Recorded changes are shown from oldest to newest."} /></p></div>
                <button type="button" className="expense-detail-refresh" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={translateCurrent("Refresh expense details")}>
                  <RefreshCw size={15} aria-hidden="true" /> <LocalizedText text={" Refresh\n                "} /></button>
              </div>
              {auditHistory.length === 0 ? (
                <p className="expense-audit-empty"><LocalizedText text={"No audit history is available for this expense."} /></p>
              ) : (
                <ol className="expense-audit-list">
                  {auditHistory.map((entry) => {
                    const changes = changedFields(entry.previousValues, entry.newValues);
                    return (
                      <li className="expense-audit-entry" key={entry.id}>
                        <div className="expense-audit-entry-heading">
                          <span className={`expense-audit-action action-${entry.action.toLowerCase()}`}>{translateCurrent(humanize(entry.action))}</span>
                          <time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time>
                        </div>
                        <p className="expense-audit-actor"><LocalizedText text={"By "} /><strong>{entry.actorNameSnapshot}</strong></p>
                        {entry.reason && <p className="expense-audit-reason"><strong><LocalizedText text={"Reason:"} /></strong> {entry.reason}</p>}
                        {changes.length > 0 && (
                          <div className="expense-audit-changes">
                            <h4>{translateCurrent(entry.action === "UPDATED" ? "Changed values" : "Recorded values")}</h4>
                            <dl>
                              {changes.map(([field, label]) => (
                                <div className="expense-audit-change" key={field}>
                                  <dt>{label}</dt>
                                  <dd><span><LocalizedText text={"Before: "} />{formatValue(field, entry.previousValues?.[field])}</span><span><LocalizedText text={"After: "} />{formatValue(field, entry.newValues[field])}</span></dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
