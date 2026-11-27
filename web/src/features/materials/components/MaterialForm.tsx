import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
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
      <h3>{translateCurrent(initialMaterial ? "Edit Material" : "Register New Material")}</h3>

      {isLoadingUnits && <div className="materials-loading"><LocalizedText text={"Loading measurement units…"} /></div>}
      {unitsError && <div className="materials-error">{translateCurrent(unitsError)}</div>}
      {!isLoadingUnits && !unitsError && units.length === 0 && (
        <div className="materials-empty">
          <LocalizedText text={"\n          No measurement units are available for this business. Add units to continue.\n          "} /><button type="button" className="secondary-button" onClick={onManageUnits}><LocalizedText text={"Manage measurement units"} /></button>
        </div>
      )}

      <div className="material-form-grid">
        <label>
          <LocalizedText text={"\n          Material Name\n          "} /><input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={translateCurrent("e.g. Cotton Fabric")}
          />
        </label>

        <label>
          <LocalizedText text={"\n          SKU\n          "} /><input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder={translateCurrent("e.g. FAB-002")}
          />
        </label>

        <label>
          <LocalizedText text={"\n          Material Type\n          "} /><select
            value={type}
            onChange={(event) => setType(event.target.value as MaterialType)}>
            <option value="FABRIC"><LocalizedText text={"Fabric"} /></option>
            <option value="POLYMER"><LocalizedText text={"Polymer"} /></option>
            <option value="THREAD"><LocalizedText text={"Thread"} /></option>
            <option value="ACCESSORY"><LocalizedText text={"Accessory"} /></option>
            <option value="PACKAGING"><LocalizedText text={"Packaging"} /></option>
            <option value="OTHER"><LocalizedText text={"Other"} /></option>
          </select>
        </label>

        <label>
          <LocalizedText text={"\n          Unit of Measure\n          "} /><select
            required
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={isLoadingUnits || units.length === 0}>
            <option value="" disabled><LocalizedText text={"Select a unit"} /></option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>
            ))}
          </select>
        </label>

        {units.length > 0 && <button type="button" className="secondary-button unit-manage-button" onClick={onManageUnits}><LocalizedText text={"Manage measurement units"} /></button>}

        <label>
          <LocalizedText text={"\n          Reorder Level ("} />{selectedUnit?.name.toLowerCase() ?? translateCurrent("selected unit")})
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
          <LocalizedText text={"\n          Description\n          "} /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={translateCurrent("Optional material details")} />
        </label>
      </div>

      <div className="material-form-actions">
        <button
          type="button"
          className="cancel-button"
          onClick={onCancel}
          disabled={isSaving}>
          <LocalizedText text={"\n          Cancel\n        "} /></button>

        <button
          type="submit"
          className="primary-button"
          disabled={isSaving || isLoadingUnits || units.length === 0 || !selectedUnit}>
          {translateCurrent(isSaving ? "Saving..." : initialMaterial ? "Save Changes" : "Save Material")}
        </button>
      </div>
    </form>
  );
}
