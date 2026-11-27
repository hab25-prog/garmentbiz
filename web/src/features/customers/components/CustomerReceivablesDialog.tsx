import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import { useCustomerReceivables } from "../hooks/useCustomers";
import type { Customer } from "../types/customer.types";
import "./customer-receivables.css";

const wholeMoney = new Intl.NumberFormat("en-ET", {
  style: "currency",
  currency: "ETB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const decimalSeparator = new Intl.NumberFormat("en-ET").formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";

function formatMoney(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, whole, fraction = ""] = match;
  return `${wholeMoney.format(BigInt(whole))}${decimalSeparator}${fraction.padEnd(2, "0").slice(0, 2)}`;
}

interface CustomerReceivablesDialogProps {
  customer: Customer;
  onClose: () => void;
}

export default function CustomerReceivablesDialog({ customer, onClose }: CustomerReceivablesDialogProps) {
  const query = useCustomerReceivables(customer.id);
  const data = query.data;

  return (
    <div className="receivables-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="receivables-dialog" role="dialog" aria-modal="true" aria-labelledby="receivables-title">
        <header className="receivables-heading">
          <div>
            <p className="receivables-eyebrow"><LocalizedText text={"CUSTOMER ACCOUNT"} /></p>
            <h2 id="receivables-title">{data?.customer.name ?? customer.name} <LocalizedText text={" receivables"} /></h2>
            <div className="receivables-contact">
              {(data?.customer.phone ?? customer.phone) && <span>{data?.customer.phone ?? customer.phone}</span>}
              {(data?.customer.email ?? customer.email) && <span>{data?.customer.email ?? customer.email}</span>}
              {!(data?.customer.phone ?? customer.phone) && !(data?.customer.email ?? customer.email) && <span><LocalizedText text={"No phone or email on file"} /></span>}
            </div>
          </div>
          <button className="receivables-close" type="button" onClick={onClose} aria-label={translateCurrent("Close customer receivables")}>×</button>
        </header>

        {query.isFetching && data && <p className="receivables-refreshing" role="status"><LocalizedText text={"Refreshing receivables…"} /></p>}
        {query.isLoading && <p className="receivables-state" role="status"><LocalizedText text={"Loading receivables…"} /></p>}
        {query.isError && !data && (
          <div className="receivables-error" role="alert">
            <p>{translateCurrent(query.error.message)}</p>
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {translateCurrent(query.isFetching ? "Retrying…" : "Retry")}
            </button>
          </div>
        )}
        {query.isError && data && (
          <div className="receivables-error" role="alert">
            <p><LocalizedText text={"Could not refresh the latest receivables. The displayed figures may be out of date."} /></p>
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}><LocalizedText text={"Retry"} /></button>
          </div>
        )}

        {data && (
          <>
            <div className="receivables-summary" aria-label={translateCurrent("Receivables summary")}>
              <article><span><LocalizedText text={"Total invoiced"} /></span><strong>{formatMoney(data.receivables.totalInvoiced)}</strong></article>
              <article><span><LocalizedText text={"Total paid"} /></span><strong>{formatMoney(data.receivables.totalPaid)}</strong></article>
              <article><span><LocalizedText text={"Outstanding balance"} /></span><strong>{formatMoney(data.receivables.totalOutstanding)}</strong></article>
              <small><LocalizedText text={"Currency: "} />{data.receivables.currency}</small>
            </div>

            {data.receivables.invoices.length === 0 ? (
              <div className="receivables-empty">
                <strong><LocalizedText text={"No issued or payable invoices"} /></strong>
                <p><LocalizedText text={"This customer has no eligible invoices to show. Draft and void invoices are excluded."} /></p>
              </div>
            ) : (
              <div className="receivables-table-wrap">
                <table className="receivables-table">
                  <thead><tr><th><LocalizedText text={"Invoice"} /></th><th><LocalizedText text={"Invoice date"} /></th><th><LocalizedText text={"Status"} /></th><th><LocalizedText text={"Total"} /></th><th><LocalizedText text={"Paid"} /></th><th><LocalizedText text={"Outstanding"} /></th></tr></thead>
                  <tbody>{data.receivables.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td><strong>{invoice.invoiceNumber}</strong></td>
                      <td>{formatAppDate(invoice.issueDate, { dateStyle: "medium" })}</td>
                      <td><span className={`receivable-status receivable-status-${invoice.status.toLowerCase()}`}>{translateCurrent(invoice.status.replaceAll("_", " "))}</span></td>
                      <td>{formatMoney(invoice.total)}</td>
                      <td>{formatMoney(invoice.paidAmount)}</td>
                      <td>{formatMoney(invoice.outstandingBalance)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
