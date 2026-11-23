import { useState } from "react";
import { useCreateOrderMaterialEstimate, useOrderMaterialEstimate, useOrderMaterialEstimates } from "../hooks/useOrders";
import type { MaterialEstimateLineStatus } from "../types/orders.types";
import "./order-material-estimate.css";

const formatEtb = (value: string | null) => {
  if (value === null) return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
};
const quantity = (value: string) => Number(value).toLocaleString("en-ET", { maximumFractionDigits: 3 });
const statusText: Record<MaterialEstimateLineStatus, string> = {
  COMPLETE: "Cost covered",
  INSUFFICIENT_STOCK: "Insufficient stock",
  NO_COST_LAYERS: "No FIFO cost layers",
  INVENTORY_DISCREPANCY: "Inventory discrepancy",
};

export default function OrderMaterialCostEstimate({ orderId }: { orderId: string }) {
  const estimatesQuery = useOrderMaterialEstimates(orderId);
  const generate = useCreateOrderMaterialEstimate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [generationError, setGenerationError] = useState("");
  const latest = estimatesQuery.data?.[0];
  const activeId = selectedId && estimatesQuery.data?.some((estimate) => estimate.id === selectedId) ? selectedId : latest?.id ?? null;
  const detailQuery = useOrderMaterialEstimate(orderId, activeId);

  async function createEstimate() {
    setGenerationError(""); setSuccess("");
    try {
      const result = await generate.mutateAsync(orderId);
      setSelectedId(result.id);
      setSuccess("A new material estimate snapshot was saved.");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Could not generate the estimate.");
    }
  }

  return <section className="order-material-estimate" aria-labelledby="material-estimate-title">
    <div className="estimate-heading">
      <div><h3 id="material-estimate-title">Estimated material costing</h3><p>Read-only estimate using this order's BOM and current FIFO inventory layers.</p></div>
      <button type="button" onClick={() => void createEstimate()} disabled={generate.isPending || estimatesQuery.isLoading}>{generate.isPending ? "Estimating…" : latest ? "Generate new estimate" : "Generate estimate"}</button>
    </div>
    {success && <p className="estimate-success" role="status">{success}</p>}
    {generationError && <p className="estimate-error" role="alert">{generationError}</p>}
    {estimatesQuery.isLoading ? <p role="status">Loading saved estimates…</p>
      : estimatesQuery.isError ? <p className="estimate-error" role="alert">{estimatesQuery.error.message}</p>
        : !latest ? <div className="estimate-empty"><strong>No material estimate saved</strong><span>Generate an estimate to snapshot this order's BOM requirements and current FIFO costs. This does not reserve or issue stock.</span></div>
          : <>
            <label className="estimate-history">Saved estimate
              <select value={activeId ?? ""} onChange={(event) => setSelectedId(event.target.value)} aria-label="Choose a saved material estimate">
                {estimatesQuery.data?.map((estimate, index) => <option key={estimate.id} value={estimate.id}>{index === 0 ? "Latest · " : "Previous · "}{new Date(estimate.estimatedAt).toLocaleString("en-ET", { timeZone: "Africa/Addis_Ababa" })} · {estimate.status}</option>)}
              </select>
            </label>
            {detailQuery.isLoading ? <p role="status">Loading estimate details…</p>
              : detailQuery.isError ? <p className="estimate-error" role="alert">{detailQuery.error.message}</p>
                : detailQuery.data && <>
                  <div className={`estimate-summary ${detailQuery.data.status === "COMPLETE" ? "complete" : "incomplete"}`}>
                    <div><span>Status</span><strong>{detailQuery.data.status === "COMPLETE" ? "Complete" : "Incomplete"}</strong></div>
                    <div><span>Total estimated material cost</span><strong>{detailQuery.data.status === "COMPLETE" ? formatEtb(detailQuery.data.totalMaterialCost) : "Not available — requirements or stock coverage are incomplete"}</strong></div>
                    <div><span>Estimated</span><strong>{new Date(detailQuery.data.estimatedAt).toLocaleString("en-ET", { timeZone: "Africa/Addis_Ababa" })}</strong></div>
                  </div>
                  <h4>Products included</h4>
                  <ul className="estimate-products">{detailQuery.data.items.map((item) => <li key={item.id}><strong>{item.productNameSnapshot}</strong><span>Ordered quantity: {item.orderedQuantity}</span>{!item.hasBom ? <em>No material requirements configured; estimate is incomplete.</em> : <span>{item.requirements.length} material requirement{item.requirements.length === 1 ? "" : "s"} captured</span>}</li>)}</ul>
                  <h4>Material and FIFO breakdown</h4>
                  {detailQuery.data.materials.length === 0 ? <p className="estimate-empty">No BOM material rows were available for the saved estimate.</p> : <div className="estimate-material-list">{detailQuery.data.materials.map((material) => <article className="estimate-material" key={material.id}>
                    <header><div><strong>{material.materialNameSnapshot}</strong><span>{material.baseUnitNameSnapshot} ({material.baseUnitCodeSnapshot}) · {statusText[material.status]}</span></div><strong>{material.status === "COMPLETE" ? formatEtb(material.estimatedCost) : "Cost unavailable"}</strong></header>
                    <div className="estimate-quantities"><span>Required <strong>{quantity(material.requiredQuantity)} {material.baseUnitCodeSnapshot}</strong></span><span>Available stock <strong>{quantity(material.availableQuantity)} {material.baseUnitCodeSnapshot}</strong></span><span>FIFO layer quantity <strong>{quantity(material.fifoAvailableQuantity)} {material.baseUnitCodeSnapshot}</strong></span>{Number(material.shortageQuantity) > 0 && <span className="estimate-shortage">Shortage <strong>{quantity(material.shortageQuantity)} {material.baseUnitCodeSnapshot}</strong></span>}</div>
                    {material.requirements.length > 1 && <details><summary>Requirement contributions</summary><ul>{material.requirements.map((requirement, index) => <li key={`${material.id}-${index}`}>{requirement.estimateItem.productNameSnapshot}: {quantity(requirement.quantityPerProduct)} × {requirement.estimateItem.orderedQuantity} = {quantity(requirement.requiredQuantity)} {material.baseUnitCodeSnapshot}</li>)}</ul></details>}
                    {material.fifoLayers.length > 0 ? <div className="estimate-layers"><strong>Simulated FIFO layers</strong><div className="estimate-layer-heading"><span>Received</span><span>Layer qty</span><span>Used</span><span>Unit cost</span><span>Layer cost</span></div>{material.fifoLayers.map((layer, index) => <div className="estimate-layer-row" key={`${material.id}-${index}`}><span>{new Date(layer.layerReceivedAtSnapshot).toLocaleDateString()}</span><span>{quantity(layer.layerAvailableQuantity)}</span><span>{quantity(layer.allocatedQuantity)}</span><span>{formatEtb(layer.unitCostSnapshot)}</span><span>{formatEtb(layer.estimatedCost)}</span></div>)}</div> : <p className="estimate-empty">No available FIFO cost layers were found for this material.</p>}
                    {material.status === "INVENTORY_DISCREPANCY" && <p className="estimate-error">Movement balance and remaining FIFO layer quantities do not reconcile. Review inventory before relying on this estimate.</p>}
                  </article>)}</div>}
                </>}
          </>}
  </section>;
}
