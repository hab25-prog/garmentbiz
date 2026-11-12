import { useState } from "react";
import { Plus, Search, RefreshCw } from "lucide-react";

import { useMaterials, useCreateMaterial, useUnits } from "../hooks/useMaterials";

import MaterialForm from "../components/MaterialForm";
import MaterialsTable from "../components/MaterialsTable";
import type { CreateMaterialInput } from "../types/material.types";

import "../../../components/Materials.css";

export default function MaterialsPage() {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const materialsQuery = useMaterials();
  const createMaterial = useCreateMaterial();
  const unitsQuery = useUnits();

  const materials = materialsQuery.data ?? [];

  const filteredMaterials = materials.filter((material) =>
    `${material.name} ${material.sku ?? ""} ${material.type}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const errorMessage =
    materialsQuery.error instanceof Error
      ? materialsQuery.error.message
      : createMaterial.error instanceof Error
        ? createMaterial.error.message
        : "";

  function handleCreateMaterial(input: CreateMaterialInput) {
    createMaterial.mutate(input, {
      onSuccess: () => {
        setShowForm(false);
      },
    });
  }

  return (
    <div className="materials-page">
      <div className="materials-heading">
        <div>
          <h1>Materials</h1>
          <p>Manage your raw materials and inventory records.</p>
        </div>

        <button
          className="primary-button"
          onClick={() => setShowForm((current) => !current)}>
          <Plus size={18} />
          Add Material
        </button>
      </div>

      {errorMessage && <div className="materials-error">{errorMessage}</div>}

      {showForm && (
        <MaterialForm
          units={unitsQuery.data ?? []}
          isLoadingUnits={unitsQuery.isLoading}
          unitsError={unitsQuery.error instanceof Error ? unitsQuery.error.message : ""}
          isSaving={createMaterial.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={handleCreateMaterial}
        />
      )}

      <div className="materials-toolbar">
        <div className="materials-search">
          <Search size={17} />
          <input
            placeholder="Search materials..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <button
          className="refresh-button"
          onClick={() => void materialsQuery.refetch()}
          disabled={materialsQuery.isFetching}>
          <RefreshCw size={16} />
          {materialsQuery.isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <MaterialsTable
        materials={filteredMaterials}
        isLoading={materialsQuery.isLoading}
      />

      <p className="materials-count">
        Showing {filteredMaterials.length} of {materials.length} materials
      </p>
    </div>
  );
}
