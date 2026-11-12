import { useState } from "react";
import type { FormEvent } from "react";
import type {
  MaterialType,
  CreateMaterialInput,
  UnitOfMeasure,
} from "../types/material.types";

interface MaterialFormProps {
  units: UnitOfMeasure[];
  isLoadingUnits: boolean;
  unitsError: string;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateMaterialInput) => void;
}

export default function MaterialForm({
  units,
  isLoadingUnits,
  unitsError,
  isSaving,
  onCancel,
  onSubmit,
}: MaterialFormProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [type, setType] = useState<MaterialType>("FABRIC");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [unitId, setUnitId] = useState("");
  const meterUnit = units.find((unit) => unit.code === "m");
  const selectedUnit = units.find((unit) => unit.id === (unitId || meterUnit?.id));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    onSubmit({
      unitId: unitId || meterUnit?.id || "",
      name: name.trim(),
      sku: sku.trim() || undefined,
      type,
      reorderLevel: Number(reorderLevel),
    });
  }

  return (
    <form className="material-form" onSubmit={handleSubmit}>
      <h3>Register New Material</h3>

      {isLoadingUnits && <div className="materials-loading">Loading measurement units…</div>}
      {unitsError && <div className="materials-error">{unitsError}</div>}
      {!isLoadingUnits && !unitsError && units.length === 0 && (
        <div className="materials-empty">No measurement units are available for this business.</div>
      )}

      <div className="material-form-grid">
        <label>
          Material Name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Cotton Fabric"
          />
        </label>

        <label>
          SKU
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="e.g. FAB-002"
          />
        </label>

        <label>
          Material Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value as MaterialType)}>
            <option value="FABRIC">Fabric</option>
            <option value="POLYMER">Polymer</option>
            <option value="THREAD">Thread</option>
            <option value="ACCESSORY">Accessory</option>
            <option value="PACKAGING">Packaging</option>
            <option value="OTHER">Other</option>
          </select>
        </label>

        <label>
          Unit of Measure
          <select
            required
            value={unitId || meterUnit?.id || ""}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={isLoadingUnits || units.length === 0}>
            <option value="" disabled>Select a unit</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>
            ))}
          </select>
        </label>

        <label>
          Reorder Level ({selectedUnit?.name.toLowerCase() ?? "selected unit"})
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={reorderLevel}
            onChange={(event) => setReorderLevel(event.target.value)}
          />
        </label>
      </div>

      <div className="material-form-actions">
        <button
          type="button"
          className="cancel-button"
          onClick={onCancel}
          disabled={isSaving}>
          Cancel
        </button>

        <button
          type="submit"
          className="primary-button"
          disabled={isSaving || isLoadingUnits || units.length === 0 || !selectedUnit}>
          {isSaving ? "Saving..." : "Save Material"}
        </button>
      </div>
    </form>
  );
}
