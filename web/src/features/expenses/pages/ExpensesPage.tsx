import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, Wallet } from "lucide-react";
import { useAuth } from "../../auth/context/AuthProvider";
import { useEmployees } from "../../employees/hooks/useEmployees";
import { useCreateExpense, useExpenses } from "../hooks/useExpenses";
import type { CreateExpenseFields, ExpenseCategory, ExpenseListFilters, ExpensePaymentMethod } from "../types/expense.types";
import { clearExpenseCreateRetry, normalizeExpenseCreateRequest, prepareExpenseCreateRetry } from "../utils/expense-retry-storage";
import ExpenseDetailDialog from "../components/ExpenseDetailDialog";
import ExpenseForm from "../components/ExpenseForm";
import ExpenseTable from "../components/ExpenseTable";
import "./expenses.css";

const viewRoles = new Set(["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"]);

const categories: { value: ExpenseCategory; label: string }[] = [
  { value: "SALARY", label: "Salary" },
  { value: "RENT", label: "Rent" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "SUPPLIES", label: "Supplies" },
  { value: "OTHER", label: "Other" },
];

const paymentMethods: { value: ExpensePaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

const initialFilters: ExpenseListFilters = {
  includeVoided: false,
  page: 1,
  pageSize: 25,
};

interface ExpensesPageProps {
  openCreateFormRequest?: boolean;
  onCreateFormRequestHandled?: () => void;
}

export default function ExpensesPage({ openCreateFormRequest = false, onCreateFormRequestHandled }: ExpensesPageProps) {
  const { membership } = useAuth();
  if (!membership || !viewRoles.has(membership.role)) {
    return (
      <main className="expenses-page">
        <section className="expense-access-denied" role="alert">
          <h1><LocalizedText text={"Expenses access restricted"} /></h1>
          <p><LocalizedText text={"Your business role does not have access to expense records."} /></p>
        </section>
      </main>
    );
  }

  return (
    <ExpensesWorkspace
      businessId={membership.business.id}
      canCreate={["OWNER", "ADMIN", "ACCOUNTANT"].includes(membership.role)}
      openCreateFormRequest={openCreateFormRequest}
      onCreateFormRequestHandled={onCreateFormRequestHandled}
    />
  );
}

function ExpensesWorkspace({
  businessId,
  canCreate,
  openCreateFormRequest,
  onCreateFormRequestHandled,
}: {
  businessId: string;
  canCreate: boolean;
  openCreateFormRequest: boolean;
  onCreateFormRequestHandled?: () => void;
}) {
  const [filters, setFilters] = useState<ExpenseListFilters>(initialFilters);
  const [searchInput, setSearchInput] = useState("");
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(() => openCreateFormRequest && canCreate);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [retryInput, setRetryInput] = useState<CreateExpenseFields | null>(null);
  const submissionLock = useRef(false);
  const createRequestHandledRef = useRef(false);
  const createFormOpenerRef = useRef<HTMLElement | null>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const expensesQuery = useExpenses(filters);
  const employeesQuery = useEmployees();
  const createExpense = useCreateExpense();
  const employees = employeesQuery.data ?? [];
  const result = expensesQuery.data;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => {
        const search = searchInput.trim();
        if ((current.search ?? "") === search) return current;
        return { ...current, ...(search ? { search } : {}), page: 1 };
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  function updateFilter<K extends keyof ExpenseListFilters>(key: K, value: ExpenseListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

  function resetFilters() {
    setSearchInput("");
    setFilters(initialFilters);
    setSelectedExpenseId(null);
  }

  const showingFrom = result && result.total > 0 ? (result.page - 1) * result.pageSize + 1 : 0;
  const showingTo = result ? Math.min(result.page * result.pageSize, result.total) : 0;

  async function submitExpense(input: CreateExpenseFields) {
    if (submissionLock.current || createExpense.isPending) return;
    submissionLock.current = true;
    setCreateError(null);

    try {
      const normalized = normalizeExpenseCreateRequest(input);
      if (!normalized) {
        setCreateError("Review the expense fields. Amount, date, and required details must be valid.");
        return;
      }

      const retry = await prepareExpenseCreateRetry(businessId, input);
      if (!retry.ok) {
        const messages = {
          "invalid-business": "The authenticated business could not be confirmed. The expense was not submitted.",
          "invalid-request": "Review the expense fields. The expense was not submitted.",
          "storage-unavailable": "Secure retry storage is unavailable. Enable session storage and retry; the expense was not submitted.",
          "malformed-storage": "Saved retry information is invalid. The expense was not submitted to avoid a possible duplicate.",
          "secure-crypto-unavailable": "Secure request protection is unavailable in this browser. The expense was not submitted.",
        } as const;
        setCreateError(messages[retry.error]);
        return;
      }

      const response = await createExpense.mutateAsync({ ...normalized, idempotencyKey: retry.pending.key });
      clearExpenseCreateRetry(businessId, retry.pending.fingerprint, retry.pending.key);
      setRetryInput(null);
      setCreateError(null);
      setSuccessMessage(response.replayed
        ? "This expense had already been recorded. The retry was confirmed successfully."
        : "Expense recorded successfully.");
      setShowCreateForm(false);
    } catch (error) {
      setRetryInput(input);
      setCreateError(error instanceof Error ? error.message : "The expense could not be confirmed. Retry with the same details.");
    } finally {
      submissionLock.current = false;
    }
  }

  function openCreateForm() {
    setCreateError(null);
    setSuccessMessage(null);
    createExpense.reset();
    setShowCreateForm(true);
  }

  useEffect(() => {
    if (!openCreateFormRequest) {
      createRequestHandledRef.current = false;
      return;
    }
    if (createRequestHandledRef.current) return;
    createRequestHandledRef.current = true;
    createFormOpenerRef.current = createTriggerRef.current;
    onCreateFormRequestHandled?.();
  }, [openCreateFormRequest, onCreateFormRequestHandled]);

  const closeExpenseDetails = useCallback(() => setSelectedExpenseId(null), []);

  return (
    <main className="expenses-page">
      <header className="expenses-heading">
        <div>
          <div className="expenses-eyebrow"><Wallet size={15} aria-hidden="true" /> <LocalizedText text={" BUSINESS FINANCES"} /></div>
          <h1><LocalizedText text={"Expenses"} /></h1>
          <p><LocalizedText text={"Review recorded payments and spending for your business."} /></p>
        </div>
        <div className="expenses-heading-actions">
          {canCreate && <button ref={(element) => { createTriggerRef.current = element; if (openCreateFormRequest && !createFormOpenerRef.current) createFormOpenerRef.current = element; }} className="expense-create-trigger" type="button" onClick={(event) => { createFormOpenerRef.current = event.currentTarget; openCreateForm(); }}><Plus size={17} aria-hidden="true" /><LocalizedText text={"Record expense"} /></button>}
          <button
            className="expense-refresh"
            type="button"
            onClick={() => void expensesQuery.refetch()}
            disabled={expensesQuery.isFetching}
            aria-label={translateCurrent("Refresh expenses")}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>{translateCurrent(expensesQuery.isFetching ? "Refreshing…" : "Refresh")}</span>
          </button>
        </div>
      </header>

      {successMessage && <div className="expense-success-message" role="status">{translateCurrent(successMessage)}</div>}

      <section className="expense-list-panel" aria-labelledby="expense-list-title">
        <div className="expense-list-heading">
          <div>
            <h2 id="expense-list-title"><LocalizedText text={"Expense records"} /></h2>
            <p><LocalizedText text={"Search and filter expenses using the business accounting records."} /></p>
          </div>
          {result && <span className="expense-total-count">{result.total} {translateCurrent(result.total === 1 ? "record" : "records")}</span>}
        </div>

        <div className="expense-filters" aria-label={translateCurrent("Expense filters")}>
          <label className="expense-search-field">
            <span><LocalizedText text={"Search"} /></span>
            <span className="expense-search-control">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={translateCurrent("Description or reference")}
                aria-label={translateCurrent("Search description or reference")}
              />
            </span>
          </label>
          <label>
            <span><LocalizedText text={"Category"} /></span>
            <select value={filters.category ?? ""} onChange={(event) => updateFilter("category", (event.target.value || undefined) as ExpenseCategory | undefined)}>
              <option value=""><LocalizedText text={"All categories"} /></option>
              {categories.map((category) => <option key={category.value} value={category.value}>{translateCurrent(category.label)}</option>)}
            </select>
          </label>
          <label>
            <span><LocalizedText text={"Payment method"} /></span>
            <select value={filters.paymentMethod ?? ""} onChange={(event) => updateFilter("paymentMethod", (event.target.value || undefined) as ExpensePaymentMethod | undefined)}>
              <option value=""><LocalizedText text={"All methods"} /></option>
              {paymentMethods.map((method) => <option key={method.value} value={method.value}>{translateCurrent(method.label)}</option>)}
            </select>
          </label>
          <label>
            <span><LocalizedText text={"Employee"} /></span>
            <select
              value={filters.employeeId ?? ""}
              onChange={(event) => updateFilter("employeeId", event.target.value || undefined)}
              disabled={employeesQuery.isLoading || employeesQuery.isError}>
              <option value=""><LocalizedText text={"All employees"} /></option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}{translateCurrent(employee.isActive ? "" : " (inactive)")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span><LocalizedText text={"From date"} /></span>
            <input type="date" value={filters.fromDate ?? ""} onChange={(event) => updateFilter("fromDate", event.target.value || undefined)} />
          </label>
          <label>
            <span><LocalizedText text={"To date"} /></span>
            <input type="date" value={filters.toDate ?? ""} onChange={(event) => updateFilter("toDate", event.target.value || undefined)} />
          </label>
          <label>
            <span><LocalizedText text={"Accounting month"} /></span>
            <input type="month" value={filters.periodMonth ?? ""} onChange={(event) => updateFilter("periodMonth", event.target.value || undefined)} />
          </label>
          <label className="expense-voided-toggle">
            <input
              type="checkbox"
              checked={filters.includeVoided ?? false}
              onChange={(event) => updateFilter("includeVoided", event.target.checked)}
            />
            <span><LocalizedText text={"Include voided expenses"} /></span>
          </label>
          <label className="expense-page-size">
            <span><LocalizedText text={"Rows per page"} /></span>
            <select value={filters.pageSize ?? 25} onChange={(event) => updateFilter("pageSize", Number(event.target.value))}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button className="expense-reset" type="button" onClick={resetFilters}><LocalizedText text={"Reset filters"} /></button>
        </div>

        {employeesQuery.isError && (
          <div className="expense-inline-error" role="alert">
            <LocalizedText text={"\n            Employee options could not be loaded. "} /><button type="button" onClick={() => void employeesQuery.refetch()}><LocalizedText text={"Retry"} /></button>
          </div>
        )}

        {expensesQuery.isError ? (
          <div className="expense-query-error" role="alert">
            <strong><LocalizedText text={"Expenses could not be loaded."} /></strong>
            <span>{translateCurrent(expensesQuery.error instanceof Error ? expensesQuery.error.message : "Please try again.")}</span>
            <button type="button" onClick={() => void expensesQuery.refetch()} disabled={expensesQuery.isFetching}>
              {translateCurrent(expensesQuery.isFetching ? "Retrying…" : "Retry")}
            </button>
          </div>
        ) : (
          <>
            <ExpenseTable
              expenses={result?.items ?? []}
              isLoading={expensesQuery.isLoading}
              selectedExpenseId={selectedExpenseId}
              onViewExpense={(expenseId, opener) => {
                detailOpenerRef.current = opener;
                setSelectedExpenseId(expenseId);
              }}
            />
            {!expensesQuery.isLoading && result && result.total > 0 && (
              <div className="expense-pagination" aria-label={translateCurrent("Expense list pagination")}>
                <span><LocalizedText text={"Showing "} />{showingFrom}–{showingTo} <LocalizedText text={" of "} />{result.total}</span>
                <div>
                  <button
                    type="button"
                    onClick={() => updateFilter("page", result.page - 1)}
                    disabled={result.page <= 1 || expensesQuery.isFetching}
                    aria-label={translateCurrent("Previous page")}><LocalizedText text={"Previous"} /></button>
                  <span><LocalizedText text={"Page "} />{result.page} <LocalizedText text={" of "} />{Math.max(result.pageCount, 1)}</span>
                  <button
                    type="button"
                    onClick={() => updateFilter("page", result.page + 1)}
                    disabled={result.page >= result.pageCount || expensesQuery.isFetching}
                    aria-label={translateCurrent("Next page")}><LocalizedText text={"Next"} /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {showCreateForm && canCreate && (
        <ExpenseForm
          key={businessId}
          returnFocusRef={createFormOpenerRef}
          businessId={businessId}
          employees={employees}
          employeesLoading={employeesQuery.isLoading}
          employeesError={employeesQuery.isError}
          onRetryEmployees={() => void employeesQuery.refetch()}
          isSubmitting={createExpense.isPending}
          errorMessage={createError}
          retryInput={retryInput}
          onSubmit={(input) => void submitExpense(input)}
          onCancel={() => {
            if (!createExpense.isPending) {
              setShowCreateForm(false);
              setCreateError(null);
            }
          }}
        />
      )}
      {selectedExpenseId && (
        <ExpenseDetailDialog
          expenseId={selectedExpenseId}
          returnFocusRef={detailOpenerRef}
          canManage={canCreate}
          employees={employees}
          employeesLoading={employeesQuery.isLoading}
          employeesError={employeesQuery.isError}
          onRetryEmployees={() => void employeesQuery.refetch()}
          onClose={closeExpenseDetails}
        />
      )}
    </main>
  );
}
