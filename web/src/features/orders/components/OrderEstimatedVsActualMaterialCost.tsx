import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import type { Order } from "../types/orders.types";
import "./order-estimated-vs-actual-material-cost.css";

function money(value: string | null) {
  if (value === null) return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export default function OrderEstimatedVsActualMaterialCost({ order }: { order: Order }) {
  const comparison = order.estimatedVsActualMaterialCost;
  if (!comparison) return null;
  const statusLabel = { UNAVAILABLE: "Unavailable", NO_COMPLETED_PRODUCTION: "No completed production", PROVISIONAL: "Provisional", COMPLETE: "Complete" }[comparison.status];
  return <section className="order-cost-comparison" aria-labelledby="order-cost-comparison-title">
    <header><div><h3 id="order-cost-comparison-title"><LocalizedText text={"Estimated vs Actual Material Cost"} /></h3><p><LocalizedText text={"Completed production quantities only · excludes work in progress."} /></p></div><span className={`cost-comparison-status ${comparison.status.toLowerCase()}`}>{translateCurrent(statusLabel)}</span></header>
    {comparison.status === "UNAVAILABLE" ? <p className="cost-comparison-message">{comparison.unavailableReason ?? translateCurrent("A complete material estimate is required.")}</p>
      : comparison.status === "NO_COMPLETED_PRODUCTION" ? <p className="cost-comparison-message"><LocalizedText text={"No completed production quantities are available to compare yet."} /></p>
        : <>
          {comparison.status === "PROVISIONAL" && <p className="cost-comparison-message"><LocalizedText text={"Some completed production usage is unreconciled or estimate snapshot data could not be matched. Available item comparisons are shown below; totals may be incomplete."} /></p>}
          {comparison.status === "COMPLETE" && <div className="cost-comparison-totals"><p><span><LocalizedText text={"Estimated cost"} /></span><strong>{money(comparison.estimatedMaterialCost)}</strong></p><p><span><LocalizedText text={"Actual reconciled cost"} /></span><strong>{money(comparison.actualMaterialCost)}</strong></p><p><span><LocalizedText text={"Variance"} /></span><strong>{money(comparison.variance)}</strong></p><p><span><LocalizedText text={"Variance percentage"} /></span><strong>{comparison.variancePercent === null ? "—" : `${comparison.variancePercent}%`}</strong></p></div>}
          {comparison.status === "COMPLETE" && comparison.variance !== null && <p className="cost-comparison-message">{translateCurrent(Number(comparison.variance) > 0 ? "Actual material cost is higher than estimated." : Number(comparison.variance) < 0 ? "Actual material cost is lower than estimated." : "Actual and estimated material costs are equal.")}</p>}
          <div className="cost-comparison-items"><h4><LocalizedText text={"By product/order item"} /></h4><div><table><thead><tr><th><LocalizedText text={"Product"} /></th><th><LocalizedText text={"Completed"} /></th><th><LocalizedText text={"Estimated"} /></th><th><LocalizedText text={"Actual"} /></th><th><LocalizedText text={"Variance"} /></th><th><LocalizedText text={"Per unit (est. / actual)"} /></th></tr></thead><tbody>
            {comparison.items.map((item) => <tr key={item.orderItemId}><td>{item.productName}{item.unavailableReason && <small>{item.unavailableReason}</small>}</td><td>{item.completedQuantity}</td><td>{money(item.estimatedMaterialCost)}</td><td>{money(item.actualMaterialCost)}</td><td>{money(item.variance)}</td><td>{item.completedQuantity > 0 ? `${money(item.estimatedCostPerUnit)} / ${money(item.actualCostPerUnit)}` : "—"}</td></tr>)}
          </tbody></table></div></div>
        </>}
  </section>;
}
