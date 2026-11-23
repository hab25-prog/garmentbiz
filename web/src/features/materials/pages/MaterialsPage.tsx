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
          <h1>Materials</h1>
          <p>Manage your raw materials and inventory records.</p>
        </div>
        <div className="materials-heading-actions">
          <button className="secondary-button" onClick={() => setShowUnitsPanel((visible) => !visible)}>Manage Units</button>
          <button className="primary-button" onClick={openCreateForm}><Plus size={18} /> Add Material</button>
        </div>
      </div>

      {materialsQuery.isError && <div className="materials-error" role="alert">{materialsQuery.error.message}</div>}
      {formError && <div className="materials-error" role="alert">{formError}</div>}
      {actionError && <div className="materials-error" role="alert">{actionError}</div>}
      {successMessage && <div className="materials-success" role="status">{successMessage}</div>}

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

      {summaryQuery.isLoading && <div className="materials-loading">Loading inventory summary…</div>}
      {summaryQuery.isError && <div className="materials-error" role="alert">{summaryQuery.error.message}</div>}
      {summaryQuery.data && (
        <section className="inventory-summary">
          <article><span>Material items</span><strong>{summaryQuery.data.totalItems}</strong></article>
          <article><span>Available stock</span><strong>{String(summaryQuery.data.totalAvailableStock)}</strong></article>
          <article><span>Low stock</span><strong>{summaryQuery.data.lowStock.length}</strong></article>
          <article><span>Out of stock</span><strong>{summaryQuery.data.outOfStock.length}</strong></article>
          <article><span>Inventory valuation</span><strong>{new Intl.NumberFormat("en-ET", { style: "currency", currency: "ETB" }).format(Number(summaryQuery.data.totalInventoryValue))}</strong></article>
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
          <input aria-label="Search materials" placeholder="Search materials..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select aria-label="Material status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ACTIVE">Active materials</option>
          <option value="ARCHIVED">Archived materials</option>
          <option value="ALL">All materials</option>
        </select>
        <button className="refresh-button" onClick={() => void materialsQuery.refetch()} disabled={materialsQuery.isFetching}>
          <RefreshCw size={16} /> {materialsQuery.isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <MaterialsTable
        materials={filteredMaterials}
        isLoading={materialsQuery.isLoading}
        isUpdating={updateMaterial.isPending}
        onEdit={(material) => { updateMaterial.reset(); createMaterial.reset(); setEditingMaterial(material); setShowForm(true); setSuccessMessage(""); }}
        onToggleActive={(id, isActive) => void toggleActive(id, isActive)}
      />
      <p className="materials-count">Showing {filteredMaterials.length} of {materials.length} materials</p>

      <section className="inventory-history">
        <div className="materials-heading"><div><h2>Stock movement history</h2><p>Recent inventory movements; balances remain derived from movement records.</p></div></div>
        <div className="materials-toolbar">
          <input aria-label="Search movements" placeholder="Search notes, references, material" value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} />
          <select aria-label="Movement type" value={movementType} onChange={(event) => setMovementType(event.target.value)}>
            <option value="">All movement types</option>
            {["PURCHASE", "MANUAL_RECEIPT", "INVENTORY_ISSUE", "INVENTORY_RETURN", "INVENTORY_WASTE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "PRODUCTION_ISSUE", "PRODUCTION_RETURN", "PRODUCTION_WASTE"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        {movementQuery.isLoading ? <p>Loading movements…</p> : movementQuery.isError ? <p className="materials-error" role="alert">{movementQuery.error.message}</p> : (
          <div className="materials-table-wrap">
            <table className="materials-table">
              <thead><tr><th>Date</th><th>Material</th><th>Type</th><th>Quantity</th><th>Reference</th><th>Notes</th></tr></thead>
              <tbody>
                {(movementQuery.data ?? []).map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.movementDate).toLocaleString()}</td>
                    <td>{movement.material.name}</td>
                    <td>{movement.movementType.replaceAll("_", " ")}</td>
                    <td>{movement.quantity} {movement.material.unit.code}</td>
                    <td>{movement.referenceType ?? "—"} {movement.referenceId ?? ""}</td>
                    <td>{movement.notes ?? "—"}</td>
                  </tr>
                ))}
                {movementQuery.data?.length === 0 && <tr><td colSpan={6}>No movements match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
