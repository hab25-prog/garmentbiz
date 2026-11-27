import { useMemo, useState } from "react";
import { ArrowUpRight, Boxes, ClipboardList, Coins, Factory, RefreshCw, ShoppingBag, Users, Wallet } from "lucide-react";
import { useLanguage } from "../../../app/providers/LanguageProvider";
import { ApiError } from "../../../lib/api-client";
import { useExpenseReport, useFinancialDashboard, useMaterialPurchasesReport, useOperationalDashboard, useProductionMaterialCostsReport } from "../hooks/useAnalytics";
import type { DashboardPeriod, ExpenseCategoryReport, ExpenseMonthReport } from "../types/analytics.types";
import { dashboardPeriodLabel, formatETB, formatQuantity, periodDateRange } from "../utils/analytics-format";
import { DonutChart, MoneyBarChart, MoneyComparisonChart, QuantityComparisonChart } from "../components/AnalyticsCharts";
import "../components/analytics.css";

const financialRoles = new Set(["OWNER", "ADMIN", "ACCOUNTANT"]);
const operationalRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY_MANAGER", "PRODUCTION_MANAGER"]);

function Metric({ icon: Icon, label, value, description }: { icon: typeof Wallet; label: string; value: string; description?: string }) {
  return <article className="analytics-metric"><div className="analytics-metric-label"><span>{label}</span><Icon size={18} aria-hidden="true" /></div><strong>{value}</strong>{description && <small>{description}</small>}</article>;
}

function QueryError({ error, retry }: { error: Error | null; retry: () => void }) {
  const { t } = useLanguage();
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : "Unable to load this report.";
  return <div className="analytics-error" role="alert"><span>{t(message)}</span><button className="analytics-retry" onClick={retry}>{t("Retry")}</button></div>;
}

function PeriodSelect({ period, onChange }: { period: DashboardPeriod; onChange: (value: DashboardPeriod) => void }) {
  const { t } = useLanguage();
  return <label className="analytics-period-label">{t("Reporting period")}<select className="analytics-period" aria-label={t("Reporting period")} value={period} onChange={(event) => onChange(event.target.value as DashboardPeriod)}>
    {(["today", "week", "month", "year"] as DashboardPeriod[]).map((value) => <option key={value} value={value}>{t(dashboardPeriodLabel(value))}</option>)}
  </select></label>;
}

export default function DashboardPage({ role, onRecordExpense, onOpenReports }: { role: string; onRecordExpense: () => void; onOpenReports: () => void }) {
  const { t, language } = useLanguage();
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const canOperational = operationalRoles.has(role);
  const canFinancial = financialRoles.has(role);
  const dates = useMemo(() => periodDateRange(period), [period]);
  const operational = useOperationalDashboard(period, canOperational);
  const financial = useFinancialDashboard(period, canFinancial);
  const expensesByCategory = useExpenseReport(dates.from, dates.to, "category", canFinancial);
  const expensesByMonth = useExpenseReport(dates.from, dates.to, "month", canFinancial);
  const purchases = useMaterialPurchasesReport(dates.from, dates.to, canFinancial);
  const productionCosts = useProductionMaterialCostsReport(dates.from, dates.to, canFinancial);

  const refresh = () => {
    void Promise.all([
      canOperational ? operational.refetch() : Promise.resolve(),
      canFinancial ? financial.refetch() : Promise.resolve(),
      canFinancial ? expensesByCategory.refetch() : Promise.resolve(),
      canFinancial ? expensesByMonth.refetch() : Promise.resolve(),
      canFinancial ? purchases.refetch() : Promise.resolve(),
      canFinancial ? productionCosts.refetch() : Promise.resolve(),
    ]);
  };

  const orderStatusData = Object.entries(operational.data?.orders.byStatus ?? {}).map(([label, value]) => ({ label, value: String(value), display: formatQuantity(value, language) }));
  const stock = operational.data?.inventory;
  const stockChart = stock ? [
    { label: "Low stock", value: String(stock.materialsWithLowStock), display: formatQuantity(stock.materialsWithLowStock, language) },
    { label: "Available stock", value: String(Math.max(0, stock.materialsAvailable - stock.materialsWithLowStock)), display: formatQuantity(Math.max(0, stock.materialsAvailable - stock.materialsWithLowStock), language) },
    { label: "Zero stock", value: String(stock.materialsWithZeroStock), display: formatQuantity(stock.materialsWithZeroStock, language) },
    { label: "Negative stock", value: String(stock.materialsWithNegativeStock), display: formatQuantity(stock.materialsWithNegativeStock, language) },
  ] : [];
  const expensesCategoryData = expensesByCategory.data?.groupBy === "category"
    ? (expensesByCategory.data as ExpenseCategoryReport).groups.map((item) => ({ label: item.category, value: item.amountETB, display: formatETB(item.amountETB, language) }))
    : [];

  return <main className="analytics-page">
    <header className="analytics-heading"><div><h1>{t("Dashboard")}</h1><p>{t("Workshop operations and recorded financial activity.")}</p></div><div className="analytics-heading-actions"><PeriodSelect period={period} onChange={setPeriod} /><button className="analytics-button" onClick={refresh} disabled={operational.isFetching || financial.isFetching} aria-label={t("Refresh dashboard")}><RefreshCw size={16} aria-hidden="true" /> {t("Refresh")}</button></div></header>

    {canOperational ? <>
      <div className="analytics-section-title"><h2>{t("Current operational snapshot")}</h2><p>{t("Current counts and balances; not limited to the selected period")}</p></div>
      {operational.isLoading ? <div className="analytics-state" role="status">{t("Loading dashboard…")}</div> : operational.isError ? <QueryError error={operational.error} retry={() => { void operational.refetch(); }} /> : operational.data && <>
        <div className="analytics-cards">
          <Metric icon={ClipboardList} label={t("Active orders")} value={formatQuantity(operational.data.orders.active, language)} description={t("Open workshop orders")} />
          <Metric icon={ClipboardList} label={t("Due today")} value={formatQuantity(operational.data.orders.dueToday, language)} description={t("Orders due on the Addis Ababa calendar today")} />
          <Metric icon={ClipboardList} label={t("Overdue orders")} value={formatQuantity(operational.data.orders.overdue, language)} description={t("Active orders past their due date")} />
          <Metric icon={Factory} label={t("Active production batches")} value={formatQuantity(operational.data.production.activeBatches, language)} />
          <Metric icon={Factory} label={t("Planned production quantity")} value={formatQuantity(operational.data.production.plannedQuantity, language)} description={t("Across current non-cancelled batches; not period-limited")} />
          <Metric icon={Factory} label={t("Completed production quantity")} value={formatQuantity(operational.data.production.completedQuantity, language)} />
          <Metric icon={Boxes} label={t("Low-stock materials")} value={formatQuantity(operational.data.inventory.materialsWithLowStock, language)} />
          <Metric icon={Boxes} label={t("Zero-stock materials")} value={formatQuantity(operational.data.inventory.materialsWithZeroStock, language)} />
          <Metric icon={Boxes} label={t("Materials available")} value={formatQuantity(operational.data.inventory.materialsAvailable, language)} />
          <Metric icon={Users} label={t("Active customers")} value={formatQuantity(operational.data.customers.active, language)} description={t("Current customer count")} />
        </div>
        <div className="analytics-chart-grid analytics-section-spacing">
          <DonutChart title={t("Orders by status")} data={orderStatusData} emptyLabel="No order activity for this view." />
          <QuantityComparisonChart title={t("Planned versus completed production")} planned={operational.data.production.plannedQuantity} completed={operational.data.production.completedQuantity} emptyLabel="No production quantities available." />
          <DonutChart title={t("Current stock status")} data={stockChart} emptyLabel="No material stock records available." />
          <section className="analytics-chart-card"><h3>{t("Orders created over time")}</h3><div className="analytics-chart-empty">{t("The operational endpoint provides a period total, not daily or monthly order history. No time-series chart is available yet.")}</div></section>
        </div>
        <div className="analytics-section-title"><h2>{t("Activity during selected period")}</h2><p>{t("Period: {period}", { period: t(dashboardPeriodLabel(period)) })}</p></div>
        <div className="analytics-cards analytics-period-cards">
          <Metric icon={Users} label={t("New customers this period")} value={formatQuantity(operational.data.customers.createdDuringPeriod, language)} />
          <Metric icon={ClipboardList} label={t("Orders created this period")} value={formatQuantity(operational.data.orders.createdDuringPeriod, language)} />
        </div>
      </>}
    </> : <section className="analytics-warning" role="status">{t("Your role does not have access to operational dashboard data.")}</section>}

    {canFinancial && <>
      <div className="analytics-section-title"><h2>{t("Financial overview")}</h2><p>{t("Period: {period}", { period: t(dashboardPeriodLabel(period)) })}</p></div>
      {financial.isLoading ? <div className="analytics-state" role="status">{t("Loading financial dashboard…")}</div> : financial.isError ? <QueryError error={financial.error} retry={() => { void financial.refetch(); }} /> : financial.data && <>
        {financial.data.currentOutstandingBalances.isComplete && financial.data.currentOutstandingBalances.totalETB !== null
          ? null
          : <div className="analytics-warning" role="status">{t("Customer balances need review. Integrity warnings prevent a reliable outstanding total.")}</div>}
        {financial.data.warnings.length > 0 && <div className="analytics-warning"><strong>{t("Review data warnings")}</strong>: {financial.data.warnings.map((warning) => `${t(warning.code)} (${warning.count})`).join(" · ")}</div>}
        <div className="analytics-cards">
          <Metric icon={Coins} label={t("Invoiced sales")} value={formatETB(financial.data.invoicedSales.totalETB, language)} description={t("Issued invoice totals for this period; not cash received.")} />
          <Metric icon={Wallet} label={t("Payments received")}
            value={formatETB(financial.data.paymentsReceived.totalETB, language)} description={t("Recorded customer payments for this period.")} />
          <Metric icon={Wallet} label={t("Current outstanding balances")} value={financial.data.currentOutstandingBalances.isComplete && financial.data.currentOutstandingBalances.totalETB !== null ? formatETB(financial.data.currentOutstandingBalances.totalETB, language) : t("Needs review")} description={t("Current snapshot across eligible invoices.")} />
          <Metric icon={ShoppingBag} label={t("Received material purchases")} value={formatETB(financial.data.receivedMaterialPurchases.totalETB, language)} description={t("Received material acquisitions, not supplier payments or operating expenses.")} />
          <Metric icon={Wallet} label={t("Operating expenses")} value={formatETB(financial.data.operatingExpenses.totalETB, language)} description={t("Recorded, non-voided operating expenses.")} />
          <Metric icon={Factory} label={t("Reconciled production material cost")} value={formatETB(financial.data.productionMaterialCost.reconciledActualETB, language)} description={financial.data.productionMaterialCost.isProvisional ? t("Reconciled to date; production usage remains provisional.") : t("Recorded material usage is reconciled for this period.")} />
        </div>
        <p className="analytics-source-note">{t("These figures are separate business measures and are not net profit.")}</p>
      </>}

      <div className="analytics-chart-grid analytics-section-spacing">
        {expensesByCategory.isLoading ? <div className="analytics-chart-card"><div className="analytics-state">{t("Loading expense chart…")}</div></div> : expensesByCategory.isError ? <div className="analytics-chart-card"><QueryError error={expensesByCategory.error} retry={() => { void expensesByCategory.refetch(); }} /></div> : <DonutChart title={t("Operating expenses by category")} data={expensesCategoryData} emptyLabel="No non-voided expenses in this period." money />}
        {expensesByMonth.isLoading ? <div className="analytics-chart-card"><div className="analytics-state">{t("Loading expense chart…")}</div></div> : expensesByMonth.isError ? <div className="analytics-chart-card"><QueryError error={expensesByMonth.error} retry={() => { void expensesByMonth.refetch(); }} /></div> : <MoneyBarChart title={t("Monthly operating expenses")} data={expensesByMonth.data?.groupBy === "month" ? (expensesByMonth.data as ExpenseMonthReport).groups.map((row) => ({ label: row.month, amount: row.totalETB })) : []} emptyLabel="No non-voided expenses in this period." />}
        {purchases.isLoading ? <div className="analytics-chart-card"><div className="analytics-state">{t("Loading purchase chart…")}</div></div> : purchases.isError ? <div className="analytics-chart-card"><QueryError error={purchases.error} retry={() => { void purchases.refetch(); }} /></div> : <MoneyBarChart title={t("Received material purchases over time")} data={purchases.data?.months.map((row) => ({ label: row.month, amount: row.amountETB })) ?? []} emptyLabel="No received material purchases in this period." />}
        {productionCosts.isLoading ? <div className="analytics-chart-card"><div className="analytics-state">{t("Loading production chart…")}</div></div> : productionCosts.isError ? <div className="analytics-chart-card"><QueryError error={productionCosts.error} retry={() => { void productionCosts.refetch(); }} /></div> : <MoneyComparisonChart title={t("Reconciled and provisional production material cost")} data={productionCosts.data?.months.map((row) => ({ label: row.month, first: row.reconciledActualETB, second: row.unreconciledUsageCostETB })) ?? []} emptyLabel="No production material cost values to chart in this period." firstLabel="Reconciled actual" secondLabel="Unreconciled provisional" />}
        <section className="analytics-chart-card"><h3>{t("Invoiced sales and payments over time")}</h3><div className="analytics-chart-empty">{t("The available dashboard API returns period totals only. Historical invoice and payment series are not available, so no trend is shown.")}</div></section>
        <section className="analytics-chart-card"><h3>{t("Estimated versus actual material cost")}</h3><div className="analytics-chart-empty">{t("The current report API does not provide comparable time-series estimate and actual values.")}</div></section>
      </div>
      <div className="analytics-report-link"><button className="analytics-button analytics-button-primary" onClick={onOpenReports}>{t("Open financial reports")} <ArrowUpRight size={15} aria-hidden="true" /></button><button className="analytics-button" onClick={onRecordExpense}>{t("Record Expense")}</button></div>
    </>}

    {!canFinancial && <section className="analytics-warning analytics-section-spacing" role="status">{t("Financial dashboard data is restricted to authorized financial roles.")}</section>}
  </main>;
}
