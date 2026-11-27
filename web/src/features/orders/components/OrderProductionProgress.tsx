import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import type { Order } from "../types/orders.types";
import "./order-production-progress.css";

const statuses = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

function safeQuantity(value: number | null | undefined): number {
  return Number.isFinite(value) && value! > 0 ? value! : 0;
}

function statusClass(status: string) {
  return `order-production-status status-${status.toLowerCase()}`;
}

export default function OrderProductionProgress({ order }: { order: Order }) {
  const batches = order.batches ?? [];
  const activeBatches = batches.filter((batch) => batch.status !== "CANCELLED");
  const summaries = order.items.map((item) => {
    const productBatches = activeBatches.filter((batch) => batch.orderItemId === item.id);
    const ordered = safeQuantity(item.quantity);
    const planned = productBatches.reduce((total, batch) => total + safeQuantity(batch.plannedQuantity), 0);
    const completed = productBatches.reduce((total, batch) => total + safeQuantity(batch.completedQuantity), 0);
    const remaining = Math.max(ordered - completed, 0);
    const progress = ordered > 0 ? Math.min((completed / ordered) * 100, 100) : 0;
    return { item, productBatches, ordered, planned, completed, remaining, progress };
  });
  const fullyCompleted = summaries.length > 0 && summaries.every((summary) => summary.ordered > 0 && summary.completed >= summary.ordered);

  return <section className="order-production-progress" aria-labelledby="order-production-title">
    <header className="order-production-heading">
      <div><h3 id="order-production-title"><LocalizedText text={"Production progress"} /></h3><p><LocalizedText text={"Progress toward producing ordered quantities. This does not indicate delivery progress."} /></p></div>
    </header>
    {batches.length === 0 ? <p className="order-production-empty"><LocalizedText text={"No production batches have been created for this order."} /></p> : <>
      <p className={`order-production-state ${fullyCompleted ? "is-complete" : "is-active"}`} role="status">
        {translateCurrent(fullyCompleted ? "Production quantities fulfilled for every product." : "Production is in progress or has not started for every product.")}
      </p>
      <div className="order-production-products">
        {summaries.map(({ item, productBatches, ordered, planned, completed, remaining, progress }) => <article className="order-production-product" key={item.id}>
          <div className="order-production-product-title"><strong>{item.product.name}</strong><span>{completed} / {ordered} <LocalizedText text={" units produced"} /></span></div>
          <div className="order-production-metrics">
            <span><LocalizedText text={"Ordered "} /><b>{ordered}</b></span><span><LocalizedText text={"Planned "} /><b>{planned}</b></span><span><LocalizedText text={"Completed "} /><b>{completed}</b></span><span><LocalizedText text={"Remaining "} /><b>{remaining}</b></span>
          </div>
          <div className="order-production-progress-track" role="progressbar" aria-label={`${item.product.name} production progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{progress.toFixed(0)}<LocalizedText text={"% production progress"} /></small>
          {productBatches.length === 0 && <small><LocalizedText text={"No active batches for this product."} /></small>}
        </article>)}
      </div>
      <div className="order-production-batch-section">
        <h4><LocalizedText text={"Production batches"} /></h4>
        <div className="order-production-batches"><table><thead><tr><th><LocalizedText text={"Batch"} /></th><th><LocalizedText text={"Product"} /></th><th><LocalizedText text={"Planned"} /></th><th><LocalizedText text={"Completed"} /></th><th><LocalizedText text={"Status"} /></th><th><LocalizedText text={"Start date"} /></th><th><LocalizedText text={"Completed date"} /></th></tr></thead>
          <tbody>{batches.map((batch) => <tr key={batch.id}>
            <td>{batch.batchNo}</td><td>{batch.orderItem?.product.name ?? translateCurrent("Unassigned product")}</td>
            <td>{safeQuantity(batch.plannedQuantity)}</td><td>{safeQuantity(batch.completedQuantity)}</td>
            <td><span className={statusClass(batch.status)}>{translateCurrent(statuses.includes(batch.status as typeof statuses[number]) ? batch.status.replaceAll("_", " ") : "Unknown")}</span></td>
            <td>{batch.startDate ? formatAppDate(batch.startDate, { dateStyle: "medium" }) : "—"}</td>
            <td>{batch.completedAt ? formatAppDate(batch.completedAt, { dateStyle: "medium" }) : "—"}</td>
          </tr>)}</tbody></table></div>
      </div>
    </>}
  </section>;
}
