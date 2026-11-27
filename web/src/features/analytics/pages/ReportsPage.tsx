import { useMemo, useState, type FormEvent } from "react";
import { useLanguage } from "../../../app/providers/LanguageProvider";
import { ApiError } from "../../../lib/api-client";
import { useExpenseReport, useFinancialSummary, useInventoryValuation, useMaterialPurchasesReport, useProductionMaterialCostsReport } from "../hooks/useAnalytics";
import { defaultReportRange, formatCalendarDate, formatETB, formatMonth, formatQuantity } from "../utils/analytics-format";
import { MoneyBarChart, MoneyComparisonChart } from "../components/AnalyticsCharts";
import type { ExpenseCategoryReport, ExpenseMonthReport } from "../types/analytics.types";
import "../components/analytics.css";

const financialRoles = new Set(["OWNER", "ADMIN", "ACCOUNTANT"]);
const inventoryCostRoles = new Set(["OWNER", "ADMIN", "ACCOUNTANT"]);

function ErrorState({ error, retry }: { error: Error | null; retry: () => void }) {
  const { t } = useLanguage();
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : "Unable to load this report.";
  return <div className="analytics-error" role="alert"><span>{t(message)}</span><button className="analytics-retry" onClick={retry}>{t("Retry")}</button></div>;
}

function Amount({ value }: { value: string }) {
  const { language } = useLanguage();
  return <>{formatETB(value, language)}</>;
}

export default function ReportsPage({ role }: { role: string }) {
  const { t, language } = useLanguage();
  const canReadFinancial = financialRoles.has(role);
  const canReadInventoryCost = inventoryCostRoles.has(role);
  const initial = useMemo(() => defaultReportRange(), []);
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState<"month" | "category">("month");
  const [filterError, setFilterError] = useState("");
  const enabled = canReadFinancial && Boolean(from && to && from <= to);
  const summary = useFinancialSummary(from, to, enabled);
  const expenses = useExpenseReport(from, to, groupBy, enabled);
  const purchases = useMaterialPurchasesReport(from, to, enabled);
  const production = useProductionMaterialCostsReport(from, to, enabled);
  const inventory = useInventoryValuation(canReadInventoryCost);
  const hasDateError = Boolean(from && to && from > to);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftFrom || !draftTo) {
      setFilterError("Choose both report dates.");
      return;
    }
    if (draftFrom > draftTo) {
      setFilterError("The start date must be on or before the end date.");
      return;
    }
    setFilterError("");
    setFrom(draftFrom);
    setTo(draftTo);
  }

  const categoryReport = expenses.data?.groupBy === "category" ? expenses.data as ExpenseCategoryReport : null;
  const monthReport = expenses.data?.groupBy === "month" ? expenses.data as ExpenseMonthReport : null;
  const stockRows = inventory.data?.byMaterial ?? [];

  if (!canReadFinancial) return <main className="analytics-page">
    <header className="analytics-heading"><div><h1>{t("Reports")}</h1><p>{t("Financial reports are restricted to authorized financial roles.")}</p></div></header>
    <div className="analytics-warning" role="status">{t("You do not have permission to view financial reports.")}</div>
  </main>;

  return <main className="analytics-page">
    <header className="analytics-heading"><div><h1>{t("Financial reports")}</h1><p>{t("Review period totals and current inventory snapshots. These reports are not profit statements.")}</p></div></header>
    <form className="analytics-filters" onSubmit={applyFilters}>
      <label>{t("From date")}<input aria-label={t("From date")} type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} required /></label>
      <label>{t("To date")}<input aria-label={t("To date")} type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} required /></label>
      <button className="analytics-button analytics-button-primary" type="submit">{t("Apply dates")}</button>
      <p className="analytics-source-note">{t("Dates use Africa/Addis_Ababa calendar days. Start and end dates are included; report ranges are limited to 24 months.")}</p>
    </form>
    {(filterError || hasDateError) && <div className="analytics-warning" role="alert">{t(filterError || "The start date must be on or before the end date.")}</div>}

    <div className="analytics-section-title"><h2>{t("Financial summary")}</h2><p>{formatCalendarDate(from, language)} — {formatCalendarDate(to, language)} · {t("Period totals")}</p></div>
    {summary.isLoading ? <div className="analytics-state" role="status">{t("Loading financial summary…")}</div> : summary.isError ? <ErrorState error={summary.error} retry={() => { void summary.refetch(); }} /> : summary.data && <>
      {summary.data.warnings.length > 0 && <div className="analytics-warning"><strong>{t("Review data warnings")}</strong>: {summary.data.warnings.map((warning) => `${t(warning.code)} (${formatQuantity(warning.count, language)})`).join(" · ")}</div>}
      <div className="analytics-cards">
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Invoiced sales")}</div><strong><Amount value={summary.data.periodTotals.invoicedSales.totalETB} /></strong><small>{t("Period total from issued invoices; not cash received.")}</small></article>
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Payments received")}</div><strong><Amount value={summary.data.periodTotals.paymentsReceived.totalETB} /></strong><small>{t("Recorded receipts during the selected period.")}</small></article>
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Received material purchases")}</div><strong><Amount value={summary.data.periodTotals.receivedMaterialPurchases.totalETB} /></strong><small>{t("Material acquisitions; not supplier payments or operating expenses.")}</small></article>
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Operating expenses")}</div><strong><Amount value={summary.data.periodTotals.operatingExpenses.totalETB} /></strong><small>{t("Non-voided recorded expenses by expense date.")}</small></article>
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Reconciled production material cost")}</div><strong><Amount value={summary.data.periodTotals.productionMaterialCost.reconciledActualETB} /></strong><small>{summary.data.periodTotals.productionMaterialCost.isProvisional ? t("Usage remains provisional until reconciled.") : t("Reconciled usage only; cost sheets are not added.")}</small></article>
      </div>
      <section className="analytics-report-snapshot"><div className="analytics-section-title"><h2>{t("Current snapshot")}</h2><p>{t("Not limited to the selected report dates")}</p></div>
        <article className="analytics-metric"><div className="analytics-metric-label">{t("Current outstanding customer balances")}</div><strong>{summary.data.currentSnapshots.outstandingCustomerBalances.isComplete && summary.data.currentSnapshots.outstandingCustomerBalances.totalETB !== null ? <Amount value={summary.data.currentSnapshots.outstandingCustomerBalances.totalETB} /> : t("Needs review")}</strong>
          {!summary.data.currentSnapshots.outstandingCustomerBalances.isComplete && <small>{t("Integrity warnings prevent a reliable balance total.")}</small>}
        </article>
      </section>
      <p className="analytics-source-note">{t("No figure on this page is net profit. Taxes, complete labor and overhead allocation, refunds, and supplier cash payments are not fully represented.")}</p>
    </>}

    <div className="analytics-section-title"><h2>{t("Operating expenses")}</h2><label className="analytics-group-label">{t("Group by")} <select className="analytics-group-select" value={groupBy} onChange={(event) => setGroupBy(event.target.value as "month" | "category")}><option value="month">{t("Month")}</option><option value="category">{t("Category")}</option></select></label></div>
    {expenses.isLoading ? <div className="analytics-state">{t("Loading expense report…")}</div> : expenses.isError ? <ErrorState error={expenses.error} retry={() => { void expenses.refetch(); }} /> : expenses.data && <>
      <p className="analytics-source-note">{t(expenses.data.source)}</p>
      {groupBy === "category" && categoryReport ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>{t("Expense category")}</th><th>{t("Expense count")}</th><th>{t("Total")}</th></tr></thead><tbody>{categoryReport.groups.map((row) => <tr key={row.category}><td>{t(row.category)}</td><td>{formatQuantity(row.expenseCount, language)}</td><td><Amount value={row.amountETB} /></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{t("Total operating expenses")}</th><th><Amount value={categoryReport.totalETB} /></th></tr></tfoot></table></div> : monthReport && <>
        <MoneyBarChart title={t("Monthly operating expenses")} data={monthReport.groups.map((row) => ({ label: row.month, amount: row.totalETB }))} emptyLabel="No non-voided expenses in this period." />
        <div className="analytics-table-wrap analytics-section-spacing"><table className="analytics-table"><thead><tr><th>{t("Month")}</th><th>{t("Expense count")}</th><th>{t("Total")}</th></tr></thead><tbody>{monthReport.groups.map((row) => <tr key={row.month}><td>{formatMonth(row.month, language)}</td><td>{formatQuantity(row.expenseCount, language)}</td><td><Amount value={row.totalETB} /></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{t("Total operating expenses")}</th><th><Amount value={monthReport.totalETB} /></th></tr></tfoot></table></div>
      </>}
    </>}

    <div className="analytics-section-title"><h2>{t("Received material purchases")}</h2><p>{t("Separate from operating expenses and supplier payments")}</p></div>
    {purchases.isLoading ? <div className="analytics-state">{t("Loading material purchase report…")}</div> : purchases.isError ? <ErrorState error={purchases.error} retry={() => { void purchases.refetch(); }} /> : purchases.data && <>
      <MoneyBarChart title={t("Received material purchases over time")} data={purchases.data.months.map((row) => ({ label: row.month, amount: row.amountETB }))} emptyLabel="No received material purchases in this period." />
      <div className="analytics-table-wrap analytics-section-spacing"><table className="analytics-table"><thead><tr><th>{t("Month")}</th><th>{t("Received purchases")}</th><th>{t("Purchase item total")}</th></tr></thead><tbody>{purchases.data.months.map((row) => <tr key={row.month}><td>{formatMonth(row.month, language)}</td><td>{formatQuantity(row.receivedPurchaseCount, language)}</td><td><Amount value={row.amountETB} /></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{t("Period total")}</th><th><Amount value={purchases.data.receivedMaterialPurchasesETB} /></th></tr></tfoot></table></div>
    </>}

    <div className="analytics-section-title"><h2>{t("Production material costs")}</h2><p>{t("Material usage value, not purchase value")}</p></div>
    {production.isLoading ? <div className="analytics-state">{t("Loading production cost report…")}</div> : production.isError ? <ErrorState error={production.error} retry={() => { void production.refetch(); }} /> : production.data && <>
      {production.data.isProvisional && <div className="analytics-warning" role="status">{t("Some production material usage is unreconciled or active. Reconciled actual and provisional amounts are shown separately.")}</div>}
      <p className="analytics-source-note">{t("The current report endpoint does not return consumed and wasted quantities separately.")}</p>
      <div className="analytics-cards"><article className="analytics-metric"><div className="analytics-metric-label">{t("Reconciled actual cost")}</div><strong><Amount value={production.data.reconciledActualETB} /></strong></article><article className="analytics-metric"><div className="analytics-metric-label">{t("Unreconciled provisional usage cost")}</div><strong><Amount value={production.data.unreconciledUsageCostETB} /></strong><small>{t("Shown separately and excluded from reconciled actual cost.")}</small></article><article className="analytics-metric"><div className="analytics-metric-label">{t("Unreconciled usage records")}</div><strong>{formatQuantity(production.data.unreconciledUsageCount, language)}</strong></article><article className="analytics-metric"><div className="analytics-metric-label">{t("Active batches with usage")}</div><strong>{formatQuantity(production.data.activeBatchCountWithUsage, language)}</strong></article></div>
      <div className="analytics-section-spacing"><MoneyComparisonChart title={t("Reconciled and provisional production material cost")} data={production.data.months.map((row) => ({ label: row.month, first: row.reconciledActualETB, second: row.unreconciledUsageCostETB }))} emptyLabel="No production material cost values to chart in this period." firstLabel="Reconciled actual" secondLabel="Unreconciled provisional" /></div>
      <div className="analytics-table-wrap analytics-section-spacing"><table className="analytics-table"><thead><tr><th>{t("Order")}</th><th>{t("Reconciled actual")}</th><th>{t("Unreconciled provisional")}</th><th>{t("Unreconciled usage")}</th></tr></thead><tbody>{production.data.byOrder.map((row) => <tr key={row.orderId}><td>{row.orderNumber}</td><td><Amount value={row.reconciledActualETB} /></td><td><Amount value={row.unreconciledUsageCostETB} /></td><td>{formatQuantity(row.unreconciledUsageCount, language)}</td></tr>)}{production.data.byOrder.length === 0 && <tr><td colSpan={4}>{t("No production material usage in this period.")}</td></tr>}</tbody></table></div>
    </>}

    {canReadInventoryCost && <>
      <div className="analytics-section-title"><h2>{t("Current inventory valuation")}</h2><p>{t("Current snapshot; not a historical value or cash balance")}</p></div>
      {inventory.isLoading ? <div className="analytics-state">{t("Loading inventory valuation…")}</div> : inventory.isError ? <ErrorState error={inventory.error} retry={() => { void inventory.refetch(); }} /> : inventory.data && <>
        <div className="analytics-cards"><article className="analytics-metric"><div className="analytics-metric-label">{t("Current FIFO inventory value")}</div><strong><Amount value={inventory.data.totalInventoryValueETB} /></strong><small>{t(inventory.data.note)}</small></article><article className="analytics-metric"><div className="analytics-metric-label">{t("Materials in valuation")}</div><strong>{formatQuantity(inventory.data.materialCount, language)}</strong></article><article className="analytics-metric"><div className="analytics-metric-label">{t("Balance discrepancies")}</div><strong>{formatQuantity(inventory.data.discrepancyCount, language)}</strong></article></div>
        <div className="analytics-table-wrap analytics-section-spacing"><table className="analytics-table"><thead><tr><th>{t("Material")}</th><th>{t("Available quantity")}</th><th>{t("FIFO layer quantity")}</th><th>{t("Difference")}</th><th>{t("Current value")}</th><th>{t("Status")}</th></tr></thead><tbody>{stockRows.map((row) => <tr key={row.materialId}><td>{row.materialName}{row.sku && <small className="analytics-table-subline">{row.sku}</small>}</td><td>{row.movementBalance} {row.unit.code}</td><td>{row.fifoLayerQuantity} {row.unit.code}</td><td>{row.discrepancyQuantity} {row.unit.code}</td><td><Amount value={row.inventoryValueETB} /></td><td><span className="analytics-status-pill">{t(row.isActive ? "Active" : "Inactive")}{!row.isConsistent ? ` · ${t("Needs review")}` : ""}</span></td></tr>)}{stockRows.length === 0 && <tr><td colSpan={6}>{t("No materials found.")}</td></tr>}</tbody></table></div>
      </>}
    </>}
  </main>;
}
