import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useState, type FormEvent } from "react";
import type { UnitOfMeasure } from "../types/material.types";
import type { CreateUnitInput } from "../api/units.api";

interface UnitManagementPanelProps {
  units: UnitOfMeasure[];
  isLoading: boolean;
  loadError: string;
  createError: string;
  defaultsError: string;
  successMessage: string;
  isCreating: boolean;
  isAddingDefaults: boolean;
  onCreate: (input: CreateUnitInput) => Promise<boolean>;
  onAddDefaults: () => void;
  onClose: () => void;
}

export default function UnitManagementPanel({
  units,
  isLoading,
  loadError,
  createError,
  defaultsError,
  successMessage,
  isCreating,
  isAddingDefaults,
  onCreate,
  onAddDefaults,
  onClose,
}: UnitManagementPanelProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onCreate({ name: name.trim(), code: code.trim() });
    if (created) {
      setName("");
      setCode("");
    }
  }

  return (
    <section className="unit-management-panel" aria-labelledby="unit-management-title">
      <div className="unit-management-heading">
        <div>
          <h3 id="unit-management-title"><LocalizedText text={"Measurement units"} /></h3>
          <p><LocalizedText text={"Units belong to this business. Conversion rates are configured separately and are never assumed."} /></p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}><LocalizedText text={"Close"} /></button>
      </div>

      {successMessage && <div className="materials-success" role="status">{translateCurrent(successMessage)}</div>}
      {loadError && <div className="materials-error" role="alert">{translateCurrent(loadError)}</div>}
      {createError && <div className="materials-error" role="alert">{translateCurrent(createError)}</div>}
      {defaultsError && <div className="materials-error" role="alert">{translateCurrent(defaultsError)}</div>}

      <form className="unit-create-form" onSubmit={submit}>
        <label>
          <LocalizedText text={"\n          Unit name\n          "} /><input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={translateCurrent("e.g. Yard")} />
        </label>
        <label>
          <LocalizedText text={"\n          Abbreviation\n          "} /><input required maxLength={12} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,11}" value={code} onChange={(event) => setCode(event.target.value)} placeholder={translateCurrent("e.g. yd")} />
        </label>
        <button type="submit" className="primary-button" disabled={isCreating || !name.trim() || !code.trim()}>
          {translateCurrent(isCreating ? "Adding…" : "Add unit")}
        </button>
      </form>

      <div className="unit-management-list-heading">
        <h4><LocalizedText text={"Available units"} /></h4>
        <button type="button" className="refresh-button" onClick={onAddDefaults} disabled={isAddingDefaults}>
          {translateCurrent(isAddingDefaults ? "Adding recommended units…" : "Add Recommended Units")}
        </button>
      </div>
      {isLoading ? <p className="materials-loading"><LocalizedText text={"Loading units…"} /></p> : units.length === 0 ? (
        <p className="materials-empty"><LocalizedText text={"No units are configured yet."} /></p>
      ) : (
        <ul className="unit-management-list">
          {units.map((unit) => <li key={unit.id}><span>{unit.name}</span><strong>{unit.code}</strong></li>)}
        </ul>
      )}
    </section>
  );
}
