import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useState, type FormEvent } from "react";
import type { CreateProductInput } from "../types/product.types";

interface ProductFormProps {
  onSubmit: (input: CreateProductInput) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

export default function ProductForm({ onSubmit, isSubmitting, onCancel }: ProductFormProps) {
  const [form, setForm] = useState<CreateProductInput>({
    name: "",
    sku: "",
    description: "",
    category: "",
    basePrice: "",
  });
  const [priceError, setPriceError] = useState("");

  function updateField(field: keyof CreateProductInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "basePrice") setPriceError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = form.basePrice?.trim();
    if (price && (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) < 0 || Number(price) > 9999999999.99)) {
      setPriceError("Enter a non-negative price with up to two decimal places (maximum ETB 9,999,999,999.99).");
      return;
    }

    onSubmit({
      name: form.name.trim(),
      ...(form.sku?.trim() ? { sku: form.sku.trim() } : {}),
      ...(form.description?.trim() ? { description: form.description.trim() } : {}),
      ...(form.category?.trim() ? { category: form.category.trim() } : {}),
      ...(price ? { basePrice: price } : {}),
    });
  }

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      <div className="product-form-heading">
        <div>
          <h2><LocalizedText text={"Add catalog product"} /></h2>
          <p><LocalizedText text={"Enter the product details and base selling price."} /></p>
        </div>
      </div>
      <div className="product-form-grid">
        <label>
          <LocalizedText text={"\n          Product name "} /><span aria-hidden="true">*</span>
          <input autoFocus required value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder={translateCurrent("e.g. Cotton T-shirt")} />
        </label>
        <label>
          <LocalizedText text={"\n          SKU\n          "} /><input value={form.sku} onChange={(event) => updateField("sku", event.target.value)} placeholder={translateCurrent("e.g. TSH-COT-001")} />
        </label>
        <label>
          <LocalizedText text={"\n          Category\n          "} /><input value={form.category} onChange={(event) => updateField("category", event.target.value)} placeholder={translateCurrent("e.g. T-shirts, Uniforms")} />
        </label>
        <label>
          <LocalizedText text={"\n          Base selling price (ETB)\n          "} /><div className="product-price-input">
            <span><LocalizedText text={"ETB"} /></span>
            <input type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" value={form.basePrice} onChange={(event) => updateField("basePrice", event.target.value)} placeholder="0.00" aria-describedby={priceError ? "product-price-error" : undefined} />
          </div>
          {priceError && <small id="product-price-error" className="product-field-error">{priceError}</small>}
        </label>
        <label className="product-full-width">
          <LocalizedText text={"\n          Description\n          "} /><textarea rows={3} value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder={translateCurrent("Optional details about this garment")} />
        </label>
      </div>
      <div className="product-form-actions">
        <button type="button" className="product-secondary-button" onClick={onCancel} disabled={isSubmitting}><LocalizedText text={"Cancel"} /></button>
        <button type="submit" className="primary-button" disabled={isSubmitting || !form.name.trim()}>{translateCurrent(isSubmitting ? "Saving..." : "Save product")}</button>
      </div>
    </form>
  );
}
