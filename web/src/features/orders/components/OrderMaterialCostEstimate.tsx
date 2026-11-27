import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
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
      <div><h3 id="material-estimate-title"><LocalizedText text={"Estimated material costing"} /></h3><p><LocalizedText text={"Read-only estimate using this order's BOM and current FIFO inventory layers."} /></p></div>
      <button type="button" onClick={() => void createEstimate()} disabled={generate.isPending || estimatesQuery.isLoading}>{translateCurrent(generate.isPending ? "Estimating…" : latest ? "Generate new estimate" : "Generate estimate")}</button>
    </div>
    {success && <p className="estimate-success" role="status">{translateCurrent(success)}</p>}
    {generationError && <p className="estimate-error" role="alert">{translateCurrent(generationError)}</p>}
    {estimatesQuery.isLoading ? <p role="status"><LocalizedText text={"Loading saved estimates…"} /></p>
      : estimatesQuery.isError ? <p className="estimate-error" role="alert">{translateCurrent(estimatesQuery.error.message)}</p>
        : !latest ? <div className="estimate-empty"><strong><LocalizedText text={"No material estimate saved"} /></strong><span><LocalizedText text={"Generate an estimate to snapshot this order's BOM requirements and current FIFO costs. This does not reserve or issue stock."} /></span></div>
          : <>
            <label className="estimate-history"><LocalizedText text={"Saved estimate\n              "} /><select value={activeId ?? ""} onChange={(event) => setSelectedId(event.target.value)} aria-label={translateCurrent("Choose a saved material estimate")}>
                {estimatesQuery.data?.map((estimate, index) => <option key={estimate.id} value={estimate.id}>{translateCurrent(index === 0 ? "Latest · " : "Previous · ")}{formatAppDate(estimate.estimatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })} · {translateCurrent(estimate.status)}</option>)}
              </select>
            </label>
            {detailQuery.isLoading ? <p role="status"><LocalizedText text={"Loading estimate details…"} /></p>
              : detailQuery.isError ? <p className="estimate-error" role="alert">{translateCurrent(detailQuery.error.message)}</p>
                : detailQuery.data && <>
                  <div className={`estimate-summary ${detailQuery.data.status === "COMPLETE" ? "complete" : "incomplete"}`}>
                    <div><span><LocalizedText text={"Status"} /></span><strong>{translateCurrent(detailQuery.data.status === "COMPLETE" ? "Complete" : "Incomplete")}</strong></div>
                    <div><span><LocalizedText text={"Total estimated material cost"} /></span><strong>{translateCurrent(detailQuery.data.status === "COMPLETE" ? formatEtb(detailQuery.data.totalMaterialCost) : "Not available — requirements or stock coverage are incomplete")}</strong></div>
                    <div><span><LocalizedText text={"Estimated"} /></span><strong>{formatAppDate(detailQuery.data.estimatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })}</strong></div>
                  </div>
                  <h4><LocalizedText text={"Products included"} /></h4>
                  <ul className="estimate-products">{detailQuery.data.items.map((item) => <li key={item.id}><strong>{item.productNameSnapshot}</strong><span><LocalizedText text={"Ordered quantity: "} />{item.orderedQuantity}</span>{!item.hasBom ? <em><LocalizedText text={"No material requirements configured; estimate is incomplete."} /></em> : <span>{item.requirements.length} <LocalizedText text={" material requirement"} />{translateCurrent(item.requirements.length === 1 ? "" : "s")} <LocalizedText text={" captured"} /></span>}</li>)}</ul>
                  <h4><LocalizedText text={"Material and FIFO breakdown"} /></h4>
                  {detailQuery.data.materials.length === 0 ? <p className="estimate-empty"><LocalizedText text={"No BOM material rows were available for the saved estimate."} /></p> : <div className="estimate-material-list">{detailQuery.data.materials.map((material) => <article className="estimate-material" key={material.id}>
                    <header><div><strong>{material.materialNameSnapshot}</strong><span>{material.baseUnitNameSnapshot} ({material.baseUnitCodeSnapshot}) · {translateCurrent(statusText[material.status])}</span></div><strong>{translateCurrent(material.status === "COMPLETE" ? formatEtb(material.estimatedCost) : "Cost unavailable")}</strong></header>
                    <div className="estimate-quantities"><span><LocalizedText text={"Required "} /><strong>{quantity(material.requiredQuantity)} {material.baseUnitCodeSnapshot}</strong></span><span><LocalizedText text={"Available stock "} /><strong>{quantity(material.availableQuantity)} {material.baseUnitCodeSnapshot}</strong></span><span><LocalizedText text={"FIFO layer quantity "} /><strong>{quantity(material.fifoAvailableQuantity)} {material.baseUnitCodeSnapshot}</strong></span>{Number(material.shortageQuantity) > 0 && <span className="estimate-shortage"><LocalizedText text={"Shortage "} /><strong>{quantity(material.shortageQuantity)} {material.baseUnitCodeSnapshot}</strong></span>}</div>
                    {material.requirements.length > 1 && <details><summary><LocalizedText text={"Requirement contributions"} /></summary><ul>{material.requirements.map((requirement, index) => <li key={`${material.id}-${index}`}>{requirement.estimateItem.productNameSnapshot}: {quantity(requirement.quantityPerProduct)} × {requirement.estimateItem.orderedQuantity} = {quantity(requirement.requiredQuantity)} {material.baseUnitCodeSnapshot}</li>)}</ul></details>}
                    {material.fifoLayers.length > 0 ? <div className="estimate-layers"><strong><LocalizedText text={"Simulated FIFO layers"} /></strong><div className="estimate-layer-heading"><span><LocalizedText text={"Received"} /></span><span><LocalizedText text={"Layer qty"} /></span><span><LocalizedText text={"Used"} /></span><span><LocalizedText text={"Unit cost"} /></span><span><LocalizedText text={"Layer cost"} /></span></div>{material.fifoLayers.map((layer, index) => <div className="estimate-layer-row" key={`${material.id}-${index}`}><span>{formatAppDate(layer.layerReceivedAtSnapshot, { dateStyle: "medium" })}</span><span>{quantity(layer.layerAvailableQuantity)}</span><span>{quantity(layer.allocatedQuantity)}</span><span>{formatEtb(layer.unitCostSnapshot)}</span><span>{formatEtb(layer.estimatedCost)}</span></div>)}</div> : <p className="estimate-empty"><LocalizedText text={"No available FIFO cost layers were found for this material."} /></p>}
                    {material.status === "INVENTORY_DISCREPANCY" && <p className="estimate-error"><LocalizedText text={"Movement balance and remaining FIFO layer quantities do not reconcile. Review inventory before relying on this estimate."} /></p>}
                  </article>)}</div>}
                </>}
          </>}
  </section>;
}
