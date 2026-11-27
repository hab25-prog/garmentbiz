import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";

import { useState } from "react";
import type {
  CreatePurchaseInput,
  CreatePurchaseItemInput,
} from "../types/purchase.types";
import { useMaterials } from "../../materials/hooks/useMaterials";
import { useSuppliers } from "../../suppliers/hooks/useSuppliers";

interface PurchaseFormProps {
  onSubmit: (input: CreatePurchaseInput) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

const emptyItem: CreatePurchaseItemInput = {
  materialId: "",
  quantity: "",
  unitCost: "",
};

export default function PurchaseForm({
  onSubmit,
  isSubmitting,
  onCancel,
}: PurchaseFormProps) {
  const { data: suppliers = [] } = useSuppliers();
  const { data: materials = [] } = useMaterials();

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [items, setItems] = useState<CreatePurchaseItemInput[]>([
    { ...emptyItem },
  ]);

  const updateItem = (
    index: number,
    field: keyof CreatePurchaseItemInput,
    value: string,
  ) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, [field]: value }
          : item,
      ),
    );
  };

  const addItem = () => {
    setItems((current) => [...current, { ...emptyItem }]);
  };

  const removeItem = (index: number) => {
    setItems((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const subtotal = items.reduce((total, item) => {
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost);

    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitCost) ||
      quantity <= 0 ||
      unitCost <= 0
    ) {
      return total;
    }

    return total + quantity * unitCost;
  }, 0);

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      maximumFractionDigits: 2,
    }).format(amount);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);

    if (!supplierId || items.length === 0) {
      return;
    }

    const validItems = items.every(
      (item) =>
        item.materialId &&
        item.quantity.trim() !== "" &&
        item.unitCost.trim() !== "" &&
        Number.isFinite(Number(item.quantity)) &&
        Number.isFinite(Number(item.unitCost)) &&
        Number(item.quantity) > 0 &&
        Number(item.unitCost) > 0,
    );

    if (!validItems) {
      setValidationError("Please complete every material item with valid positive values.");
      return;
    }

    const materialIds = items.map((item) => item.materialId);

    if (new Set(materialIds).size !== materialIds.length) {
      setValidationError("Each material can only appear once in a purchase.");
      return;
    }

    onSubmit({
      supplierId,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      items,
    });
  };

  return (
    <form className="purchase-form" onSubmit={handleSubmit}>
      {validationError && <p className="purchase-validation-error" role="alert">{translateCurrent(validationError)}</p>}
      <div className="purchase-form-section">
        <h3><LocalizedText text={"Purchase Information"} /></h3>

        <label>
          <LocalizedText text={"\n          Supplier *\n          "} /><select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            required
          >
            <option value=""><LocalizedText text={"Select supplier"} /></option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <LocalizedText text={"\n          Notes\n          "} /><textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder={translateCurrent("Optional purchase notes")}
          />
        </label>
      </div>

      <div className="purchase-form-section">
        <div className="purchase-section-heading">
          <h3><LocalizedText text={"Purchase Items"} /></h3>
          <button type="button" onClick={addItem}>
            <LocalizedText text={"\n            + Add Item\n          "} /></button>
        </div>

        {items.map((item, index) => {
          const selectedMaterial = materials.find(
            (material) => material.id === item.materialId,
          );

          const lineTotal =
            Number(item.quantity) * Number(item.unitCost);

          return (
            <div className="purchase-item-row" key={index}>
              <label>
                <LocalizedText text={"\n                Material *\n                "} /><select
                  value={item.materialId}
                  onChange={(event) =>
                    updateItem(index, "materialId", event.target.value)
                  }
                  required
                >
                  <option value=""><LocalizedText text={"Select material"} /></option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} ({material.unit.code})
                    </option>
                  ))}
                </select>
              </label>

              {selectedMaterial && (
                <small>
                  <LocalizedText text={"\n                  Unit: "} />{selectedMaterial.unit.name} (
                  {selectedMaterial.unit.code})
                </small>
              )}

              <label>
                <LocalizedText text={"\n                Quantity *\n                "} /><input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(index, "quantity", event.target.value)
                  }
                  placeholder={translateCurrent("e.g. 100")}
                  required
                />
              </label>

              <label>
                <LocalizedText text={"\n                Unit Cost (ETB) *\n                "} /><input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={item.unitCost}
                  onChange={(event) =>
                    updateItem(index, "unitCost", event.target.value)
                  }
                  placeholder={translateCurrent("e.g. 50")}
                  required
                />
              </label>

              <p>
                <LocalizedText text={"\n                Line Total:"} />{" "}
                {formatMoney(Number.isFinite(lineTotal) ? lineTotal : 0)}
              </p>

              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                >
                  <LocalizedText text={"\n                  Remove\n                "} /></button>
              )}
            </div>
          );
        })}
      </div>

      <div className="purchase-subtotal">
        <span><LocalizedText text={"Purchase Subtotal"} /></span>
        <strong>{formatMoney(subtotal)}</strong>
      </div>

      {suppliers.length === 0 && (
        <p><LocalizedText text={"Please create a supplier before making a purchase."} /></p>
      )}

      {materials.length === 0 && (
        <p><LocalizedText text={"Please create a material before making a purchase."} /></p>
      )}

      <div className="purchase-form-actions">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          <LocalizedText text={"\n          Cancel\n        "} /></button>

        <button
          type="submit"
          disabled={
            isSubmitting ||
            suppliers.length === 0 ||
            materials.length === 0
          }
        >
          {translateCurrent(isSubmitting ? "Creating..." : "Create Purchase")}
        </button>
      </div>
    </form>
  );
}
