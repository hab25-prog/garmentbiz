import { useMemo, useState } from "react";
import PurchaseForm from "../components/PurchaseForm";
import PurchasesTable from "../components/PurchasesTable";
import {
  useCreatePurchase,
  usePurchases,
  useReceivePurchase,
} from "../hooks/usePurchases";
import type { CreatePurchaseInput } from "../types/purchase.types";
import "./Purchases.css";

export default function PurchasesPage() {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [receivingPurchaseId, setReceivingPurchaseId] = useState<string | null>(
    null,
  );

  const purchasesQuery = usePurchases();
  const createMutation = useCreatePurchase();
  const receiveMutation = useReceivePurchase();

  const purchases = purchasesQuery.data ?? [];

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return purchases;

    return purchases.filter(
      (purchase) =>
        purchase.purchaseNo.toLowerCase().includes(query) ||
        purchase.supplier.name.toLowerCase().includes(query) ||
        purchase.status.toLowerCase().includes(query),
    );
  }, [purchases, search]);

  const handleCreate = async (input: CreatePurchaseInput) => {
    try {
      await createMutation.mutateAsync(input);
      setShowForm(false);
      alert("Purchase created successfully.");
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Failed to create purchase.",
      );
    }
  };

  const handleReceive = async (purchaseId: string) => {
    setReceivingPurchaseId(purchaseId);

    try {
      await receiveMutation.mutateAsync(purchaseId);
      alert("Purchase received successfully. Inventory has been updated.");
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Failed to receive purchase.",
      );
    } finally {
      setReceivingPurchaseId(null);
    }
  };

  const draftCount = purchases.filter(
    (purchase) => purchase.status === "DRAFT",
  ).length;

  const receivedCount = purchases.filter(
    (purchase) => purchase.status === "RECEIVED",
  ).length;

  return (
    <div className="purchases-page">
      <div className="purchases-page-header">
        <div>
          <h1>Purchases</h1>
          <p>Manage supplier purchases and incoming materials.</p>
        </div>

        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}>
          {showForm ? "Close Form" : "+ New Purchase"}
        </button>
      </div>

      <div className="purchase-summary">
        <div className="purchase-summary-card">
          <span>Total Purchases</span>
          <strong>{purchases.length}</strong>
        </div>

        <div className="purchase-summary-card">
          <span>Draft Purchases</span>
          <strong>{draftCount}</strong>
        </div>

        <div className="purchase-summary-card">
          <span>Received Purchases</span>
          <strong>{receivedCount}</strong>
        </div>
      </div>

      {showForm && (
        <section className="purchase-form-card">
          <h2>Create New Purchase</h2>

          <PurchaseForm
            onSubmit={handleCreate}
            isSubmitting={createMutation.isPending}
            onCancel={() => setShowForm(false)}
          />
        </section>
      )}

      <section className="purchases-list-section">
        <div className="purchases-list-header">
          <div>
            <h2>Purchase Records</h2>
            <p>View and receive your supplier purchases.</p>
          </div>

          <button
            type="button"
            onClick={() => purchasesQuery.refetch()}
            disabled={purchasesQuery.isFetching}>
            {purchasesQuery.isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <input
          type="search"
          className="purchase-search"
          placeholder="Search by purchase number, supplier, or status..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {purchasesQuery.isLoading ? (
          <p>Loading purchases...</p>
        ) : purchasesQuery.isError ? (
          <div className="purchase-error">
            <p>Failed to load purchases.</p>
            <button type="button" onClick={() => purchasesQuery.refetch()}>
              Try Again
            </button>
          </div>
        ) : (
          <PurchasesTable
            purchases={filteredPurchases}
            isReceiving={receiveMutation.isPending}
            receivingPurchaseId={receivingPurchaseId}
            onReceive={handleReceive}
          />
        )}
      </section>
    </div>
  );
}
