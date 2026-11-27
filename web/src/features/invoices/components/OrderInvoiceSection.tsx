import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import { useState, type FormEvent } from "react";
import { useCreateOrderInvoice, useIssueInvoice, useOrderInvoice, useRecordInvoicePayment } from "../hooks/useOrderInvoice";
import { usePendingPaymentStorage } from "../hooks/usePendingPaymentStorage";
import type { CreateInvoicePaymentInput, Invoice } from "../types/invoice.types";
import {
  clearPendingPayment,
  createPaymentIdempotencyKey,
  fingerprintPaymentRequest,
  readPendingPayment,
  savePendingPayment,
  type PendingPaymentSubmission,
} from "../utils/payment-retry-storage";
import "./order-invoice-section.css";

const money = new Intl.NumberFormat("en-ET", {
  style: "currency",
  currency: "ETB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const decimalSeparator = new Intl.NumberFormat("en-ET").formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";

function formatMoney(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction = ""] = match;
  const amount = money.format(BigInt(whole));
  const fractional = fraction.padEnd(2, "0").slice(0, 2);
  return `${sign}${amount}${decimalSeparator}${fractional}`;
}

function InvoiceSnapshot({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <div className="invoice-meta">
        <span><strong><LocalizedText text={"Invoice date"} /></strong>{formatAppDate(invoice.issueDate, { dateStyle: "medium" })}</span>
        <span><strong><LocalizedText text={"Subtotal"} /></strong>{formatMoney(invoice.subtotal)}</span>
        <span><strong><LocalizedText text={"Discount"} /></strong>{formatMoney(invoice.discount)}</span>
        <span><strong><LocalizedText text={"Tax"} /></strong>{formatMoney(invoice.tax)}</span>
        <span><strong><LocalizedText text={"Total"} /></strong>{formatMoney(invoice.totalAmount)}</span>
      </div>
      <div className="invoice-lines-wrap">
        <table className="invoice-lines">
          <thead><tr><th><LocalizedText text={"Item"} /></th><th><LocalizedText text={"Quantity"} /></th><th><LocalizedText text={"Unit price"} /></th><th><LocalizedText text={"Line total"} /></th></tr></thead>
          <tbody>{invoice.items.map((item) => (
            <tr key={item.id}>
              <td>{item.description}</td><td>{item.quantity}</td>
              <td>{formatMoney(item.unitPrice)}</td><td>{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {invoice.paymentSummary && (
        <div className="invoice-payment-summary" aria-label={translateCurrent("Invoice payment summary")}>
          <span><strong><LocalizedText text={"Invoice total"} /></strong>{formatMoney(invoice.totalAmount)}</span>
          <span><strong><LocalizedText text={"Total paid"} /></strong>{formatMoney(invoice.paymentSummary.totalPaid)}</span>
          <span><strong><LocalizedText text={"Outstanding balance"} /></strong>{formatMoney(invoice.paymentSummary.outstandingBalance)}</span>
          <span><strong><LocalizedText text={"Payment status"} /></strong>{translateCurrent(invoice.paymentSummary.paymentStatus.replaceAll("_", " "))}</span>
        </div>
      )}
      {invoice.payments && invoice.payments.length > 0 && (
        <div className="invoice-history">
          <h4><LocalizedText text={"Payment history"} /></h4>
          <div className="invoice-lines-wrap">
            <table className="invoice-lines">
              <thead><tr><th><LocalizedText text={"Date"} /></th><th><LocalizedText text={"Method"} /></th><th><LocalizedText text={"Amount"} /></th><th><LocalizedText text={"Reference"} /></th><th><LocalizedText text={"Notes"} /></th></tr></thead>
              <tbody>{invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatAppDate(payment.paymentDate, { dateStyle: "medium" })}</td>
                  <td>{translateCurrent(payment.method.replaceAll("_", " "))}</td>
                  <td>{formatMoney(payment.amount)}</td>
                  <td>{payment.reference || "—"}</td>
                  <td>{payment.notes || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {invoice.payments?.length === 0 && <p className="invoice-history-empty"><LocalizedText text={"No payments have been recorded yet."} /></p>}
    </>
  );
}

export default function OrderInvoiceSection({ orderId }: { orderId: string }) {
  const invoiceQuery = useOrderInvoice(orderId);
  const createInvoice = useCreateOrderInvoice(orderId);
  const issueInvoice = useIssueInvoice(orderId);
  const recordPayment = useRecordInvoicePayment(orderId);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [paymentValidationError, setPaymentValidationError] = useState("");
  const [storageFailure, setStorageFailure] = useState<{ invoiceId: string; failed: boolean } | null>(null);
  const [memoryPending, setMemoryPending] = useState<Array<{ invoiceId: string; submission: PendingPaymentSubmission }>>([]);
  const invoice = invoiceQuery.data;
  const storedPayment = usePendingPaymentStorage(invoice?.id ?? null);
  const memoryPendingForInvoice = invoice ? memoryPending.filter((entry) => entry.invoiceId === invoice.id).map((entry) => entry.submission) : [];
  const knownPending = [...storedPayment.pending, ...memoryPendingForInvoice];
  const unresolvedPendingCount = new Set(knownPending.map((entry) => `${entry.fingerprint}:${entry.key}`)).size;
  const pendingPaymentNotice = unresolvedPendingCount > 0;
  const storageWarning = Boolean(invoice && (!storedPayment?.storageAvailable || (storageFailure?.invoiceId === invoice.id && storageFailure.failed)));

  async function create() {
    setSuccessMessage("");
    try {
      await createInvoice.mutateAsync();
      setSuccessMessage("Draft invoice created.");
    } catch {
      // The mutation error is displayed below.
    }
  }

  async function issue() {
    if (!invoice) return;
    setSuccessMessage("");
    try {
      await issueInvoice.mutateAsync(invoice.id);
      setConfirmIssue(false);
      setSuccessMessage("Invoice issued successfully.");
    } catch {
      // The mutation error is displayed below.
    }
  }

  function paymentDetailsChanged() {
    setPaymentValidationError("");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice || (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID")) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = String(values.get("paymentAmount") ?? "");
    const method = String(values.get("paymentMethod") ?? "");
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) || /^0(?:\.0{1,2})?$/.test(amount)) {
      setPaymentValidationError("Enter an amount greater than zero with no more than two decimal places.");
      return;
    }
    const payment: Omit<CreateInvoicePaymentInput, "idempotencyKey"> = {
      amount,
      method: method as CreateInvoicePaymentInput["method"],
      ...(String(values.get("paymentDate") ?? "") ? { paymentDate: String(values.get("paymentDate")) } : {}),
      ...(String(values.get("reference") ?? "").trim() ? { reference: String(values.get("reference")).trim() } : {}),
      ...(String(values.get("notes") ?? "").trim() ? { notes: String(values.get("notes")).trim() } : {}),
    };
    setPaymentValidationError("");
    setSuccessMessage("");
    let requestStarted = false;
    try {
      const fingerprint = await fingerprintPaymentRequest({ invoiceId: invoice.id, ...payment });
      const persisted = readPendingPayment(invoice.id);
      const reusable = persisted.pending.find((entry) => entry.fingerprint === fingerprint) ??
        memoryPending.find((entry) => entry.invoiceId === invoice.id && entry.submission.fingerprint === fingerprint)?.submission ?? null;
      const submission = reusable ?? { version: 1 as const, fingerprint, key: createPaymentIdempotencyKey() };
      setMemoryPending((records) => records.some((entry) => entry.invoiceId === invoice.id && entry.submission.key === submission.key)
        ? records
        : [...records, { invoiceId: invoice.id, submission }]);
      const saved = savePendingPayment(invoice.id, submission);
      setStorageFailure({ invoiceId: invoice.id, failed: !saved });
      requestStarted = true;
      const result = await recordPayment.mutateAsync({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        payment: { ...payment, idempotencyKey: submission.key },
      });
      clearPendingPayment(invoice.id, submission.fingerprint, submission.key);
      setMemoryPending((records) => records.filter((entry) => !(entry.invoiceId === invoice.id && entry.submission.fingerprint === submission.fingerprint && entry.submission.key === submission.key)));
      setSuccessMessage(result.replayed ? "This payment was already recorded. Invoice balances are up to date." : "Payment recorded successfully.");
      form.reset();
    } catch (error) {
      if (!requestStarted && error instanceof Error) {
        setPaymentValidationError(error.message);
      }
      // Keep the persisted record for an unchanged retry, including when the response was lost after saving.
    }
  }

  return (
    <section className="order-invoice-section" aria-labelledby="order-invoice-title">
      <div className="order-invoice-heading">
        <div><h3 id="order-invoice-title"><LocalizedText text={"Invoice"} /></h3><p><LocalizedText text={"Commercial invoice for this customer order."} /></p></div>
        {invoice && <span className={`invoice-status invoice-status-${invoice.status.toLowerCase()}`}>{translateCurrent(invoice.status.replaceAll("_", " "))}</span>}
      </div>

      {invoiceQuery.isLoading ? <p className="invoice-message"><LocalizedText text={"Loading invoice…"} /></p> : null}
      {invoiceQuery.isError ? <p className="invoice-message invoice-error" role="alert">{translateCurrent(invoiceQuery.error.message)}</p> : null}
      {!invoiceQuery.isLoading && !invoiceQuery.isError && !invoice && (
        <div className="invoice-empty">
          <p><LocalizedText text={"This order does not have an invoice yet."} /></p>
          <button type="button" disabled={createInvoice.isPending} onClick={() => void create()}>
            {translateCurrent(createInvoice.isPending ? "Creating invoice…" : "Create Invoice")}
          </button>
        </div>
      )}
      {invoice && (
        <>
          <div className="invoice-title-row"><strong>{invoice.invoiceNo}</strong><span>{translateCurrent(invoice.status.replaceAll("_", " "))}</span></div>
          <InvoiceSnapshot invoice={invoice} />
          {pendingPaymentNotice && (
            <div className="invoice-pending-payment" role="status">
              <strong>{unresolvedPendingCount === 1 ? translateCurrent("An earlier payment submission may need confirmation.") : translateCurrent("{count} earlier payment submissions may need confirmation.", { count: unresolvedPendingCount })}</strong>
              <span><LocalizedText text={"Re-enter the same payment details to safely retry that submission. Matching details reuse its retry key; changed details start a separate submission without discarding earlier retries."} /></span>
            </div>
          )}
          {storageWarning && (
            <p className="invoice-message invoice-storage-warning" role="status">
              <LocalizedText text={"\n              This browser could not save payment retry protection for this tab. Keep this invoice open while retrying; closing or reloading may lose the retry key.\n            "} /></p>
          )}
          {(invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") ? (
            <form className="invoice-payment-form" onSubmit={(event) => void submitPayment(event)} onChange={paymentDetailsChanged}>
              <h4><LocalizedText text={"Record a payment"} /></h4>
              <fieldset className="invoice-payment-fields" disabled={recordPayment.isPending}>
                <label><LocalizedText text={"Amount (ETB)"} /><input name="paymentAmount" type="text" inputMode="decimal" autoComplete="off" required placeholder="0.00" aria-describedby="payment-amount-help" /></label>
                <label><LocalizedText text={"Payment method"} /><select name="paymentMethod" required defaultValue=""><option value="" disabled><LocalizedText text={"Select method"} /></option><option value="CASH"><LocalizedText text={"Cash"} /></option><option value="BANK_TRANSFER"><LocalizedText text={"Bank transfer"} /></option><option value="MOBILE_MONEY"><LocalizedText text={"Mobile money"} /></option><option value="CARD"><LocalizedText text={"Card"} /></option><option value="OTHER"><LocalizedText text={"Other"} /></option></select></label>
                <label><LocalizedText text={"Payment date (optional)"} /><input name="paymentDate" type="date" /></label>
                <label><LocalizedText text={"Reference (optional)"} /><input name="reference" type="text" maxLength={128} /></label>
                <label className="invoice-payment-notes"><LocalizedText text={"Notes (optional)"} /><textarea name="notes" maxLength={2000} rows={2} /></label>
              </fieldset>
              <small id="payment-amount-help"><LocalizedText text={"Enter a positive amount with up to two decimal places. The server validates the remaining balance."} /></small>
              {paymentValidationError && <p className="invoice-message invoice-error" role="alert">{translateCurrent(paymentValidationError)}</p>}
              {recordPayment.isError && <p className="invoice-message invoice-error" role="alert">{translateCurrent(recordPayment.error.message)}</p>}
              <button type="submit" disabled={recordPayment.isPending}>{translateCurrent(recordPayment.isPending ? "Recording payment…" : "Record Payment")}</button>
            </form>
          ) : (
            <p className="invoice-payment-unavailable"><LocalizedText text={"Payments can only be recorded when an invoice is issued or partially paid."} /></p>
          )}
          {invoice.status === "DRAFT" && (
            <div className="invoice-actions">
              {!confirmIssue ? (
                <button type="button" disabled={issueInvoice.isPending} onClick={() => setConfirmIssue(true)}><LocalizedText text={"Issue Invoice"} /></button>
              ) : (
                <div className="invoice-confirm" role="group" aria-label={translateCurrent("Confirm issuing invoice")}>
                  <p><LocalizedText text={"Issuing changes this invoice from DRAFT to ISSUED. Continue?"} /></p>
                  <button type="button" disabled={issueInvoice.isPending} onClick={() => void issue()}>{translateCurrent(issueInvoice.isPending ? "Issuing…" : "Confirm issue")}</button>
                  <button type="button" className="invoice-secondary" disabled={issueInvoice.isPending} onClick={() => setConfirmIssue(false)}><LocalizedText text={"Cancel"} /></button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {createInvoice.isError && <p className="invoice-message invoice-error" role="alert">{translateCurrent(createInvoice.error.message)}</p>}
      {issueInvoice.isError && <p className="invoice-message invoice-error" role="alert">{translateCurrent(issueInvoice.error.message)}</p>}
      {successMessage && <p className="invoice-message invoice-success" role="status">{translateCurrent(successMessage)}</p>}
    </section>
  );
}
