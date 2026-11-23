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
          <h3 id="unit-management-title">Measurement units</h3>
          <p>Units belong to this business. Conversion rates are configured separately and are never assumed.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>

      {successMessage && <div className="materials-success" role="status">{successMessage}</div>}
      {loadError && <div className="materials-error" role="alert">{loadError}</div>}
      {createError && <div className="materials-error" role="alert">{createError}</div>}
      {defaultsError && <div className="materials-error" role="alert">{defaultsError}</div>}

      <form className="unit-create-form" onSubmit={submit}>
        <label>
          Unit name
          <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Yard" />
        </label>
        <label>
          Abbreviation
          <input required maxLength={12} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,11}" value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. yd" />
        </label>
        <button type="submit" className="primary-button" disabled={isCreating || !name.trim() || !code.trim()}>
          {isCreating ? "Adding…" : "Add unit"}
        </button>
      </form>

      <div className="unit-management-list-heading">
        <h4>Available units</h4>
        <button type="button" className="refresh-button" onClick={onAddDefaults} disabled={isAddingDefaults}>
          {isAddingDefaults ? "Adding recommended units…" : "Add Recommended Units"}
        </button>
      </div>
      {isLoading ? <p className="materials-loading">Loading units…</p> : units.length === 0 ? (
        <p className="materials-empty">No units are configured yet.</p>
      ) : (
        <ul className="unit-management-list">
          {units.map((unit) => <li key={unit.id}><span>{unit.name}</span><strong>{unit.code}</strong></li>)}
        </ul>
      )}
    </section>
  );
}
