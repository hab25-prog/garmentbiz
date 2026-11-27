import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import type { ExpenseListItem } from "../types/expense.types";
import { formatAppDate } from "../../../app/utils/format-app-date";

interface ExpenseTableProps {
  expenses: ExpenseListItem[];
  isLoading: boolean;
  selectedExpenseId: string | null;
  onViewExpense: (expenseId: string, opener: HTMLButtonElement) => void;
}

function formatMoney(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return "ETB —";
  const [, sign, whole, fractional = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `ETB ${sign}${grouped}.${fractional.padEnd(2, "0").slice(0, 2)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return formatAppDate(date, {
    dateStyle: "medium",
    timeZone: "Africa/Addis_Ababa",
  });
}

function humanize(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ExpenseTable({ expenses, isLoading, selectedExpenseId, onViewExpense }: ExpenseTableProps) {
  return (
    <div className="expense-table-scroll">
      <table className="expense-table">
        <caption className="expense-visually-hidden"><LocalizedText text={"Business expense records"} /></caption>
        <thead>
          <tr>
            <th scope="col"><LocalizedText text={"Date"} /></th>
            <th scope="col"><LocalizedText text={"Description"} /></th>
            <th scope="col"><LocalizedText text={"Category"} /></th>
            <th scope="col"><LocalizedText text={"Payment method"} /></th>
            <th scope="col"><LocalizedText text={"Employee"} /></th>
            <th scope="col" className="expense-amount-cell"><LocalizedText text={"Amount"} /></th>
            <th scope="col"><LocalizedText text={"Status"} /></th>
            <th scope="col"><LocalizedText text={"Details"} /></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={8} className="expense-table-message" role="status"><LocalizedText text={"Loading expenses…"} /></td></tr>
          ) : expenses.length === 0 ? (
            <tr>
              <td colSpan={8} className="expense-table-message">
                <strong><LocalizedText text={"No expenses found"} /></strong>
                <span><LocalizedText text={"Try changing or resetting your filters."} /></span>
              </td>
            </tr>
          ) : expenses.map((expense) => {
            const isVoided = expense.voidedAt !== null;
            const selected = selectedExpenseId === expense.id;
            return (
              <tr key={expense.id} className={`${isVoided ? "is-voided" : ""} ${selected ? "is-selected" : ""}`}>
                <td data-label="Date">{formatDate(expense.expenseDate)}</td>
                <td data-label="Description">
                  <div className="expense-description-cell">
                    <strong>{expense.description}</strong>
                    {expense.reference && <span><LocalizedText text={"Ref. "} />{expense.reference}</span>}
                  </div>
                </td>
                <td data-label="Category">{translateCurrent(humanize(expense.category))}</td>
                <td data-label="Payment method">{expense.paymentMethod ? translateCurrent(humanize(expense.paymentMethod)) : <span className="expense-muted"><LocalizedText text={"Not recorded"} /></span>}</td>
                <td data-label="Employee">{expense.employee?.fullName ?? <span className="expense-muted">—</span>}</td>
                <td data-label="Amount" className="expense-amount-cell">{formatMoney(expense.amount)}</td>
                <td data-label="Status">
                  <span className={`expense-status ${isVoided ? "voided" : "recorded"}`}>
                    {translateCurrent(isVoided ? "Voided" : "Recorded")}
                  </span>
                </td>
                <td data-label="Details">
                  <button type="button" className="expense-view-details" onClick={(event) => onViewExpense(expense.id, event.currentTarget)}>
                    <LocalizedText text={"\n                    View details"} /><span className="expense-visually-hidden"> <LocalizedText text={" for "} />{expense.description}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selectedExpenseId && expenses.some((expense) => expense.id === selectedExpenseId) && (
        <p className="expense-selection-note" role="status"><LocalizedText text={"Expense selected for details."} /></p>
      )}
    </div>
  );
}
