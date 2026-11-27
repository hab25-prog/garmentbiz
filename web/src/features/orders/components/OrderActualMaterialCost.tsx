import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import type { Order } from "../types/orders.types";
import "./order-actual-material-cost.css";

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "ETB 0.00";
}

export default function OrderActualMaterialCost({ order }: { order: Order }) {
  const summary = order.productionActualMaterialCost;
  const activeBatches = summary?.batchCosts ?? [];
  const hasActiveUsage = activeBatches.some((batch) => batch.usageCount > 0);

  return <section className="order-actual-cost" aria-labelledby="order-actual-cost-title">
    <header><div><h3 id="order-actual-cost-title"><LocalizedText text={"Actual Material Cost"} /></h3><p><LocalizedText text={"Based on reconciled production material usage. Returned material is excluded; wastage remains included."} /></p></div>
      {summary && <span className={`actual-cost-badge ${summary.isFinal ? "final" : "provisional"}`}>{translateCurrent(summary.isFinal ? "Final" : "Provisional")}</span>}
    </header>
    {!summary ? <p role="alert" className="actual-cost-empty"><LocalizedText text={"Actual material cost summary is unavailable."} /></p>
      : !hasActiveUsage ? <p className="actual-cost-empty"><LocalizedText text={"No material has been issued to active production batches."} /></p>
        : <>
          <div className="actual-cost-total"><span><LocalizedText text={"Reconciled actual cost to date"} /></span><strong>{money(summary.totalReconciledMaterialCost)}</strong></div>
          {summary.unreconciledUsageCount > 0 && <p className="actual-cost-warning" role="status">{summary.unreconciledUsageCount} <LocalizedText text={" material usage record"} />{translateCurrent(summary.unreconciledUsageCount === 1 ? " is" : "s are")} <LocalizedText text={" not reconciled. The displayed total excludes these provisional usages, so it is not a final production cost."} /></p>}
          {!summary.isFinal && summary.unreconciledUsageCount === 0 && <p className="actual-cost-note" role="status"><LocalizedText text={"Production is not complete. This amount is a reconciled cost to date, not the final order material cost."} /></p>}
          {summary.productCosts.length > 0 && <div className="actual-cost-products"><h4><LocalizedText text={"By product"} /></h4>{summary.productCosts.map((product) => <p key={product.orderItemId}><span>{product.productName}</span><strong>{money(product.materialCost)}</strong></p>)}</div>}
          <div className="actual-cost-batches"><h4><LocalizedText text={"By production batch"} /></h4><div><table><thead><tr><th><LocalizedText text={"Batch"} /></th><th><LocalizedText text={"Status"} /></th><th><LocalizedText text={"Reconciled cost"} /></th><th><LocalizedText text={"Reconciliation"} /></th></tr></thead><tbody>
            {summary.batchCosts.map((batch) => <tr key={batch.batchId}><td>{batch.batchNo}</td><td>{translateCurrent(batch.status.replaceAll("_", " "))}</td><td>{money(batch.materialCost)}</td><td>{batch.unreconciledUsageCount === 0 ? translateCurrent("{count} reconciled", { count: batch.reconciledUsageCount }) : translateCurrent("{count} unreconciled of {total}", { count: batch.unreconciledUsageCount, total: batch.usageCount })}</td></tr>)}
          </tbody></table></div></div>
          <p className="actual-cost-scope">{summary.completedBatchCount} <LocalizedText text={" of "} />{summary.activeBatchCount} <LocalizedText text={" active batches completed. Cancelled batch costs remain in history and are excluded from this active summary."} /></p>
        </>}
  </section>;
}
