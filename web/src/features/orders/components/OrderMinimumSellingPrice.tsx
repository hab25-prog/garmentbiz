import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/context/AuthProvider";
import { useCreateOrderPricing, useOrderPricing } from "../hooks/useOrders";
import "./order-minimum-selling-price.css";

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function validMarkup(value: string) {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(text)) return false;
  const [whole = "0", fraction = ""] = text.split(".");
  const integer = BigInt(whole);
  return integer < 1000n || (integer === 1000n && /^0{0,2}$/.test(fraction));
}

export default function OrderMinimumSellingPrice({ orderId }: { orderId: string }) {
  const { membership } = useAuth();
  const isOwner = membership?.role === "OWNER";
  const pricingQuery = useOrderPricing(orderId);
  const createPricing = useCreateOrderPricing();
  const [markupInput, setMarkupInput] = useState("");
  const [validationError, setValidationError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const data = pricingQuery.data;
  const latestEstimate = data?.latestEstimate;
  const canPrice = latestEstimate?.status === "COMPLETE" && latestEstimate.totalMaterialCost !== null;
  const markupDisplay = markupInput || data?.history[0]?.markupPercent || "5";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(""); setActionError(""); setSuccess("");
    if (!validMarkup(markupDisplay)) {
      setValidationError("Enter a markup from 0% to 1000%, with up to two decimal places.");
      return;
    }
    try {
      await createPricing.mutateAsync({ orderId, markupPercent: markupDisplay.trim() });
      setMarkupInput(markupDisplay.trim());
      setSuccess("Minimum selling price calculation saved to pricing history.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not calculate minimum selling price.");
    }
  }

  return <section className="minimum-selling-price" aria-labelledby="minimum-selling-price-title">
    <header className="minimum-price-heading"><div><h3 id="minimum-selling-price-title"><LocalizedText text={"Minimum Selling Price"} /></h3><p><LocalizedText text={"Material cost only · markup on cost · excludes labor and overhead."} /></p></div></header>
    {pricingQuery.isLoading ? <p role="status"><LocalizedText text={"Loading pricing history…"} /></p>
      : pricingQuery.isError ? <p role="alert" className="minimum-price-error">{translateCurrent(pricingQuery.error.message)}</p>
        : <>
          {!latestEstimate && <p className="minimum-price-blocked" role="status"><LocalizedText text={"Generate a material estimate before a minimum selling price can be calculated."} /></p>}
          {latestEstimate?.status === "INCOMPLETE" && <p className="minimum-price-blocked" role="status"><LocalizedText text={"The latest material estimate is incomplete. Resolve missing BOM requirements, shortages, or inventory discrepancies and generate a complete estimate before calculating a selling price."} /></p>}
          {latestEstimate?.status === "COMPLETE" && !data?.currentPricing && <p className="minimum-price-blocked" role="status"><LocalizedText text={"No pricing calculation exists for the latest complete material estimate yet."} /></p>}
          {data?.currentPricing && <div className="minimum-price-current">
            <div className="minimum-price-values">
              <p><span><LocalizedText text={"Material cost"} /></span><strong>{money(data.currentPricing.materialCost)}</strong></p>
              <p><span><LocalizedText text={"Markup ("} />{data.currentPricing.markupPercent}%)</span><strong>{money(data.currentPricing.markupAmount)}</strong></p>
              <p><span><LocalizedText text={"Minimum selling price · entire order"} /></span><strong>{money(data.currentPricing.minimumOrderPrice)}</strong></p>
              <p><span><LocalizedText text={"Total ordered quantity"} /></span><strong>{data.currentPricing.totalOrderedQuantity}</strong></p>
              <p><span><LocalizedText text={"Average selling price per unit"} /></span><strong>{money(data.currentPricing.averageUnitPrice)}</strong></p>
              <p><span><LocalizedText text={"Calculated"} /></span><strong>{formatAppDate(data.currentPricing.calculatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })}</strong></p>
            </div>
            <p className="minimum-price-estimate-ref"><LocalizedText text={"Based on material estimate from "} />{formatAppDate(data.currentPricing.materialEstimate.estimatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })}.</p>
          </div>}
          {isOwner && <form className="minimum-price-form" onSubmit={(event) => void submit(event)}>
            <label><LocalizedText text={"Markup percentage"} /><input inputMode="decimal" value={markupDisplay} onChange={(event) => { setMarkupInput(event.target.value); setValidationError(""); }} disabled={!canPrice || createPricing.isPending} aria-describedby="minimum-price-markup-help" /></label>
            <small id="minimum-price-markup-help"><LocalizedText text={"Default 5%. Markup is applied to material cost. Range 0%–1000%, up to 2 decimal places."} /></small>
            {validationError && <p className="minimum-price-error" role="alert">{translateCurrent(validationError)}</p>}
            {actionError && <p className="minimum-price-error" role="alert">{translateCurrent(actionError)}</p>}
            {success && <p className="minimum-price-success" role="status">{translateCurrent(success)}</p>}
            <button type="submit" disabled={!canPrice || createPricing.isPending}>{translateCurrent(createPricing.isPending ? "Calculating…" : data?.currentPricing ? "Save new calculation" : "Calculate minimum selling price")}</button>
          </form>}
          {!isOwner && <p className="minimum-price-owner-note"><LocalizedText text={"Only the business owner can create a pricing calculation or change its markup."} /></p>}
          {!!data?.history.length && <div className="minimum-price-history"><h4><LocalizedText text={"Pricing history"} /></h4><div className="minimum-price-history-list">{data.history.map((record) => <article key={record.id}>
            <header><strong>{money(record.minimumOrderPrice)}</strong><span>{translateCurrent(record.id === data.currentPricing?.id ? "Current" : "Historical")}</span></header>
            <p>{record.markupPercent}<LocalizedText text={"% markup · "} />{record.totalOrderedQuantity} <LocalizedText text={" units · average "} />{money(record.averageUnitPrice)}</p>
            <small><LocalizedText text={"Calculated "} />{formatAppDate(record.calculatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })}</small>
            <small><LocalizedText text={"Estimate "} />{formatAppDate(record.materialEstimate.estimatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" })} · {translateCurrent(record.materialEstimate.status)}</small>
          </article>)}</div></div>}
        </>}
  </section>;
}
