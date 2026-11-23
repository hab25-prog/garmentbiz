import { useState } from "react";
import type { FormEvent } from "react";
import type {
  MaterialType,
  CreateMaterialInput,
  UnitOfMeasure,
} from "../types/material.types";
import type { Material } from "../types/material.types";

interface MaterialFormProps {
  units: UnitOfMeasure[];
  isLoadingUnits: boolean;
  unitsError: string;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateMaterialInput) => void;
  initialMaterial?: Material;
  onManageUnits: () => void;
}

export default function MaterialForm({
  units,
  isLoadingUnits,
  unitsError,
  isSaving,
  onCancel,
  onSubmit,
  initialMaterial,
  onManageUnits,
}: MaterialFormProps) {
  const [name, setName] = useState(initialMaterial?.name ?? "");
  const [sku, setSku] = useState(initialMaterial?.sku ?? "");
  const [type, setType] = useState<MaterialType>(initialMaterial?.type ?? "FABRIC");
  const [reorderLevel, setReorderLevel] = useState(initialMaterial?.reorderLevel ?? "0");
  const [description, setDescription] = useState(initialMaterial?.description ?? "");
  const [unitId, setUnitId] = useState(initialMaterial?.unit.id ?? "");
  const selectedUnit = units.find((unit) => unit.id === unitId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    onSubmit({
      unitId,
      name: name.trim(),
      sku: initialMaterial ? sku.trim() : sku.trim() || undefined,
      type,
      reorderLevel: Number(reorderLevel),
      description: description.trim(),
    });
  }

  return (
    <form className="material-form" onSubmit={handleSubmit}>
      <h3>{initialMaterial ? "Edit Material" : "Register New Material"}</h3>

      {isLoadingUnits && <div className="materials-loading">Loading measurement units…</div>}
      {unitsError && <div className="materials-error">{unitsError}</div>}
      {!isLoadingUnits && !unitsError && units.length === 0 && (
        <div className="materials-empty">
          No measurement units are available for this business. Add units to continue.
          <button type="button" className="secondary-button" onClick={onManageUnits}>Manage measurement units</button>
        </div>
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
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={isLoadingUnits || units.length === 0}>
            <option value="" disabled>Select a unit</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>
            ))}
          </select>
        </label>

        {units.length > 0 && <button type="button" className="secondary-button unit-manage-button" onClick={onManageUnits}>Manage measurement units</button>}

        <label>
          Reorder Level ({selectedUnit?.name.toLowerCase() ?? "selected unit"})
          <input
            type="number"
            min="0"
            step="0.001"
            required
            value={reorderLevel}
            onChange={(event) => setReorderLevel(event.target.value)}
          />
        </label>

        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional material details" />
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
          {isSaving ? "Saving..." : initialMaterial ? "Save Changes" : "Save Material"}
        </button>
      </div>
    </form>
  );
}
