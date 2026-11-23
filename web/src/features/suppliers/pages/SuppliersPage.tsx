import { useState } from "react";
import { Plus, Search, RefreshCw } from "lucide-react";

import { useSuppliers, useCreateSupplier } from "../hooks/useSuppliers";
import SupplierForm from "../components/SupplierForm";
import SuppliersTable from "../components/SuppliersTable";

import type { CreateSupplierInput } from "../types/supplier.types";

import "./Suppliers.css";

export default function SuppliersPage() {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const suppliersQuery = useSuppliers();
  const createSupplier = useCreateSupplier();

  const suppliers = suppliersQuery.data ?? [];

  const filteredSuppliers = suppliers.filter((supplier) =>
    `${supplier.name} ${supplier.contactName ?? ""} ${
      supplier.phone ?? ""
    } ${supplier.email ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const errorMessage = createSupplier.error instanceof Error
    ? createSupplier.error.message
    : suppliersQuery.error instanceof Error
      ? suppliersQuery.error.message
      : "";

  function handleCreateSupplier(input: CreateSupplierInput) {
    createSupplier.mutate(input, {
      onSuccess: () => {
        setShowForm(false);
        setSuccessMessage("Supplier was created successfully.");
      },
    });
  }

  return (
    <div className="materials-page suppliers-page">
      <div className="materials-heading">
        <div>
          <h1>Suppliers</h1>
          <p>Manage your fabric, polymer, accessories, and other suppliers.</p>
        </div>

        <button
          className="primary-button"
          disabled={createSupplier.isPending}
          onClick={() => { createSupplier.reset(); setSuccessMessage(""); setShowForm((current) => !current); }}>
          <Plus size={18} />
          Add Supplier
        </button>
      </div>

      {errorMessage && <div className="materials-error" role="alert">{errorMessage}</div>}
      {successMessage && <div className="materials-success" role="status">{successMessage}</div>}
      {suppliersQuery.isLoading && <div className="materials-loading">Loading suppliers…</div>}

      {showForm && (
        <SupplierForm
          isSubmitting={createSupplier.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={handleCreateSupplier}
        />
      )}

      <div className="materials-toolbar">
        <div className="materials-search">
          <Search size={17} />
          <input
            placeholder="Search suppliers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <button
          className="refresh-button"
          onClick={() => void suppliersQuery.refetch()}
          disabled={suppliersQuery.isFetching}>
          <RefreshCw size={16} />
          {suppliersQuery.isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <SuppliersTable suppliers={filteredSuppliers} isLoading={suppliersQuery.isLoading} />

      <p className="materials-count">
        Showing {filteredSuppliers.length} of {suppliers.length} suppliers
      </p>
    </div>
  );
}
