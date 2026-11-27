import { LocalizedText, useLanguage, translateCurrent } from "../../../app/providers/LanguageProvider";
import type { Purchase } from "../types/purchase.types";
import { formatAppDate } from "../../../app/utils/format-app-date";

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
  const { t } = useLanguage();
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
            <th><LocalizedText text={"Purchase No."} /></th>
            <th><LocalizedText text={"Supplier"} /></th>
            <th><LocalizedText text={"Date"} /></th>
            <th><LocalizedText text={"Items"} /></th>
            <th><LocalizedText text={"Subtotal"} /></th>
            <th><LocalizedText text={"Status"} /></th>
            <th><LocalizedText text={"Action"} /></th>
          </tr>
        </thead>

        <tbody>
          {purchases.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-purchases">
                <LocalizedText text={"\n                No purchases found.\n              "} /></td>
            </tr>
          ) : (
            purchases.map((purchase) => (
              <tr key={purchase.id}>
                <td>
                  <strong>{purchase.purchaseNo}</strong>
                </td>

                <td>{purchase.supplier.name}</td>

                <td>{formatAppDate(purchase.purchaseDate, { dateStyle: "medium" })}</td>

                <td>{purchase.items.length}</td>

                <td>{formatMoney(purchase.subtotal)}</td>

                <td>
                  <span
                    className={`purchase-status purchase-status-${purchase.status.toLowerCase()}`}>
                    {translateCurrent(t(purchase.status))}
                  </span>
                </td>

                <td>
                  {purchase.status === "DRAFT" ? (
                    <button
                      type="button"
                      disabled={isReceiving}
                      onClick={() => {
                        const confirmed = window.confirm(
                          t("Receive purchase {purchaseNo}? This will add its quantities to inventory.", { purchaseNo: purchase.purchaseNo }),
                        );

                        if (confirmed) {
                          onReceive(purchase.id);
                        }
                      }}>
                      {translateCurrent(isReceiving && receivingPurchaseId === purchase.id
                        ? "Receiving..."
                        : "Receive")}
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
