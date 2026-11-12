import type { Purchase } from "../types/purchase.types";

interface PurchasesTableProps {
  purchases: Purchase[];
  isReceiving: boolean;
  receivingPurchaseId: string | null;
  onReceive: (purchaseId: string) => void;
}

export default function PurchasesTable({
  purchases,
  isReceiving,
  receivingPurchaseId,
  onReceive,
}: PurchasesTableProps) {
  const formatMoney = (amount: string) =>
    new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      maximumFractionDigits: 2,
    }).format(Number(amount));

  return (
    <div className="purchases-table-wrapper">
      <table className="purchases-table">
        <thead>
          <tr>
            <th>Purchase No.</th>
            <th>Supplier</th>
            <th>Date</th>
            <th>Items</th>
            <th>Subtotal</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {purchases.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-purchases">
                No purchases found.
              </td>
            </tr>
          ) : (
            purchases.map((purchase) => (
              <tr key={purchase.id}>
                <td>
                  <strong>{purchase.purchaseNo}</strong>
                </td>

                <td>{purchase.supplier.name}</td>

                <td>{new Date(purchase.purchaseDate).toLocaleDateString()}</td>

                <td>{purchase.items.length}</td>

                <td>{formatMoney(purchase.subtotal)}</td>

                <td>
                  <span
                    className={`purchase-status purchase-status-${purchase.status.toLowerCase()}`}>
                    {purchase.status}
                  </span>
                </td>

                <td>
                  {purchase.status === "DRAFT" ? (
                    <button
                      type="button"
                      disabled={isReceiving}
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Receive purchase ${purchase.purchaseNo}? This will add its quantities to inventory.`,
                        );

                        if (confirmed) {
                          onReceive(purchase.id);
                        }
                      }}>
                      {isReceiving && receivingPurchaseId === purchase.id
                        ? "Receiving..."
                        : "Receive"}
                    </button>
                  ) : (
                    <span className="purchase-no-action">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
