import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { formatAppDate } from "../../../app/utils/format-app-date";
import { useEffect, useRef, useState } from "react";
import { Plus, Search, RefreshCw } from "lucide-react";

import {
  useMaterials,
  useCreateMaterial,
  useUnits,
  useInventorySummary,
  useStockMovements,
  useUpdateMaterial,
  useCreateUnit,
  useAddRecommendedUnits,
} from "../hooks/useMaterials";
import MaterialForm from "../components/MaterialForm";
import UnitManagementPanel from "../components/UnitManagementPanel";
import MaterialsTable from "../components/MaterialsTable";
import type { CreateMaterialInput, Material } from "../types/material.types";

import "../../../components/Materials.css";

export default function MaterialsPage() {
  const [showForm, setShowForm] = useState(false);
  const [showUnitsPanel, setShowUnitsPanel] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [successMessage, setSuccessMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [movementSearch, setMovementSearch] = useState("");
  const [movementType, setMovementType] = useState("");
  const unitManagementRef = useRef<HTMLDivElement>(null);

  const materialsQuery = useMaterials(true);
  const createMaterial = useCreateMaterial();
  const unitsQuery = useUnits();
  const summaryQuery = useInventorySummary();
  const movementQuery = useStockMovements({ search: movementSearch, type: movementType });
  const updateMaterial = useUpdateMaterial();
  const createUnit = useCreateUnit();
  const addRecommendedUnits = useAddRecommendedUnits();
  const materials = materialsQuery.data ?? [];

  const filteredMaterials = materials.filter((material) => {
    const matchesSearch = `${material.name} ${material.sku ?? ""} ${material.type}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" ||
      (statusFilter === "ARCHIVED" ? material.isActive === false : material.isActive !== false);
    return matchesSearch && matchesStatus;
  });

  function openCreateForm() {
    createMaterial.reset();
    updateMaterial.reset();
    setEditingMaterial(null);
    setSuccessMessage("");
    setActionError("");
    setShowForm((current) => !current);
  }

  function handleSubmit(input: CreateMaterialInput) {
    setActionError("");
    if (editingMaterial) {
      updateMaterial.mutate({ id: editingMaterial.id, input }, {
        onSuccess: () => {
          setShowForm(false);
          setEditingMaterial(null);
          setSuccessMessage("Material details were updated.");
        },
      });
      return;
    }
    createMaterial.mutate(input, {
      onSuccess: () => {
        setShowForm(false);
        setSuccessMessage("Material was created successfully.");
      },
    });
  }

  async function toggleActive(materialId: string, isActive: boolean) {
    setActionError("");
    setSuccessMessage("");
    try {
      await updateMaterial.mutateAsync({ id: materialId, input: { isActive: !isActive } });
      setSuccessMessage(isActive ? "Material was archived." : "Material was restored.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update material.");
    }
  }

  const formError = createMaterial.error instanceof Error
    ? createMaterial.error.message
    : updateMaterial.error instanceof Error
      ? updateMaterial.error.message
      : "";
  const isSaving = createMaterial.isPending || updateMaterial.isPending;

  useEffect(() => {
    if (showUnitsPanel) unitManagementRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [showUnitsPanel]);

  async function handleCreateUnit(input: { name: string; code: string }): Promise<boolean> {
    setSuccessMessage("");
    try {
      await createUnit.mutateAsync(input);
      setSuccessMessage(`${input.name.trim()} was added as a measurement unit.`);
      return true;
    } catch {
      // The mutation error is rendered in the unit management panel.
      return false;
    }
  }

  async function handleAddRecommendedUnits() {
    setSuccessMessage("");
    try {
      const result = await addRecommendedUnits.mutateAsync();
      setSuccessMessage(`${result.addedCount} recommended units added; ${result.alreadyExistedCount} already existed.`);
    } catch {
      // The mutation error is rendered in the unit management panel.
    }
  }

  return (
    <div className="materials-page">
      <div className="materials-heading">
        <div>
          <h1><LocalizedText text={"Materials"} /></h1>
          <p><LocalizedText text={"Manage your raw materials and inventory records."} /></p>
        </div>
        <div className="materials-heading-actions">
          <button className="secondary-button" onClick={() => setShowUnitsPanel((visible) => !visible)}><LocalizedText text={"Manage Units"} /></button>
          <button className="primary-button" onClick={openCreateForm}><Plus size={18} /> <LocalizedText text={" Add Material"} /></button>
        </div>
      </div>

      {materialsQuery.isError && <div className="materials-error" role="alert">{translateCurrent(materialsQuery.error.message)}</div>}
      {formError && <div className="materials-error" role="alert">{translateCurrent(formError)}</div>}
      {actionError && <div className="materials-error" role="alert">{translateCurrent(actionError)}</div>}
      {successMessage && <div className="materials-success" role="status">{translateCurrent(successMessage)}</div>}

      {showUnitsPanel && (
        <div ref={unitManagementRef}>
          <UnitManagementPanel
            units={unitsQuery.data ?? []}
            isLoading={unitsQuery.isLoading}
            loadError={unitsQuery.error instanceof Error ? unitsQuery.error.message : ""}
            createError={createUnit.error instanceof Error ? createUnit.error.message : ""}
            defaultsError={addRecommendedUnits.error instanceof Error ? addRecommendedUnits.error.message : ""}
            successMessage={successMessage}
            isCreating={createUnit.isPending}
            isAddingDefaults={addRecommendedUnits.isPending}
            onCreate={handleCreateUnit}
            onAddDefaults={() => void handleAddRecommendedUnits()}
            onClose={() => setShowUnitsPanel(false)}
          />
        </div>
      )}

      {summaryQuery.isLoading && <div className="materials-loading"><LocalizedText text={"Loading inventory summary…"} /></div>}
      {summaryQuery.isError && <div className="materials-error" role="alert">{translateCurrent(summaryQuery.error.message)}</div>}
      {summaryQuery.data && (
        <section className="inventory-summary">
          <article><span><LocalizedText text={"Material items"} /></span><strong>{summaryQuery.data.totalItems}</strong></article>
          <article><span><LocalizedText text={"Available stock"} /></span><strong>{String(summaryQuery.data.totalAvailableStock)}</strong></article>
          <article><span><LocalizedText text={"Low stock"} /></span><strong>{summaryQuery.data.lowStock.length}</strong></article>
          <article><span><LocalizedText text={"Out of stock"} /></span><strong>{summaryQuery.data.outOfStock.length}</strong></article>
          <article><span><LocalizedText text={"Inventory valuation"} /></span><strong>{new Intl.NumberFormat("en-ET", { style: "currency", currency: "ETB" }).format(Number(summaryQuery.data.totalInventoryValue))}</strong></article>
        </section>
      )}

      {showForm && (
        <MaterialForm
          key={editingMaterial?.id ?? "new-material"}
          initialMaterial={editingMaterial ?? undefined}
          units={unitsQuery.data ?? []}
          isLoadingUnits={unitsQuery.isLoading}
          unitsError={unitsQuery.error instanceof Error ? unitsQuery.error.message : ""}
          isSaving={isSaving}
          onManageUnits={() => setShowUnitsPanel(true)}
          onCancel={() => { setShowForm(false); setEditingMaterial(null); }}
          onSubmit={handleSubmit}
        />
      )}

      <div className="materials-toolbar">
        <div className="materials-search">
          <Search size={17} />
          <input aria-label={translateCurrent("Search materials")} placeholder={translateCurrent("Search materials...")} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select aria-label={translateCurrent("Material status")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ACTIVE"><LocalizedText text={"Active materials"} /></option>
          <option value="ARCHIVED"><LocalizedText text={"Archived materials"} /></option>
          <option value="ALL"><LocalizedText text={"All materials"} /></option>
        </select>
        <button className="refresh-button" onClick={() => void materialsQuery.refetch()} disabled={materialsQuery.isFetching}>
          <RefreshCw size={16} /> {translateCurrent(materialsQuery.isFetching ? "Refreshing..." : "Refresh")}
        </button>
      </div>

      <MaterialsTable
        materials={filteredMaterials}
        isLoading={materialsQuery.isLoading}
        isUpdating={updateMaterial.isPending}
        onEdit={(material) => { updateMaterial.reset(); createMaterial.reset(); setEditingMaterial(material); setShowForm(true); setSuccessMessage(""); }}
        onToggleActive={(id, isActive) => void toggleActive(id, isActive)}
      />
      <p className="materials-count"><LocalizedText text={"Showing "} />{filteredMaterials.length} <LocalizedText text={" of "} />{materials.length} <LocalizedText text={" materials"} /></p>

      <section className="inventory-history">
        <div className="materials-heading"><div><h2><LocalizedText text={"Stock movement history"} /></h2><p><LocalizedText text={"Recent inventory movements; balances remain derived from movement records."} /></p></div></div>
        <div className="materials-toolbar">
          <input aria-label={translateCurrent("Search movements")} placeholder={translateCurrent("Search notes, references, material")} value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} />
          <select aria-label={translateCurrent("Movement type")} value={movementType} onChange={(event) => setMovementType(event.target.value)}>
            <option value=""><LocalizedText text={"All movement types"} /></option>
            {["PURCHASE", "MANUAL_RECEIPT", "INVENTORY_ISSUE", "INVENTORY_RETURN", "INVENTORY_WASTE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "PRODUCTION_ISSUE", "PRODUCTION_RETURN", "PRODUCTION_WASTE"].map((type) => <option key={type} value={type}>{translateCurrent(type.replaceAll("_", " "))}</option>)}
          </select>
        </div>
        {movementQuery.isLoading ? <p><LocalizedText text={"Loading movements…"} /></p> : movementQuery.isError ? <p className="materials-error" role="alert">{translateCurrent(movementQuery.error.message)}</p> : (
          <div className="materials-table-wrap">
            <table className="materials-table">
              <thead><tr><th><LocalizedText text={"Date"} /></th><th><LocalizedText text={"Material"} /></th><th><LocalizedText text={"Type"} /></th><th><LocalizedText text={"Quantity"} /></th><th><LocalizedText text={"Reference"} /></th><th><LocalizedText text={"Notes"} /></th></tr></thead>
              <tbody>
                {(movementQuery.data ?? []).map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatAppDate(movement.movementDate, { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{movement.material.name}</td>
                    <td>{translateCurrent(movement.movementType.replaceAll("_", " "))}</td>
                    <td>{movement.quantity} {movement.material.unit.code}</td>
                    <td>{movement.referenceType ?? "—"} {movement.referenceId ?? ""}</td>
                    <td>{movement.notes ?? "—"}</td>
                  </tr>
                ))}
                {movementQuery.data?.length === 0 && <tr><td colSpan={6}><LocalizedText text={"No movements match."} /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
