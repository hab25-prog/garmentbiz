import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import type { Supplier } from "../types/supplier.types";

interface SuppliersTableProps {
  suppliers: Supplier[];
  isLoading: boolean;
}

export default function SuppliersTable({ suppliers, isLoading }: SuppliersTableProps) {
  if (isLoading) {
    return <div className="supplier-empty-state"><p><LocalizedText text={"Loading suppliers…"} /></p></div>;
  }

  if (suppliers.length === 0) {
    return (
      <div className="supplier-empty-state">
        <h3><LocalizedText text={"No suppliers found"} /></h3>
        <p><LocalizedText text={"Add your first supplier to start managing supplier information."} /></p>
      </div>
    );
  }

  return (
    <div className="supplier-table-container">
      <table className="supplier-table">
        <thead>
          <tr>
            <th><LocalizedText text={"Supplier Name"} /></th>
            <th><LocalizedText text={"Contact Person"} /></th>
            <th><LocalizedText text={"Phone"} /></th>
            <th><LocalizedText text={"Email"} /></th>
            <th><LocalizedText text={"Address"} /></th>
            <th><LocalizedText text={"Status"} /></th>
          </tr>
        </thead>

        <tbody>
          {suppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td>
                <strong>{supplier.name}</strong>
              </td>
              <td>{supplier.contactName || "—"}</td>
              <td>{supplier.phone || "—"}</td>
              <td>{supplier.email || "—"}</td>
              <td>{supplier.address || "—"}</td>
              <td>
                <span
                  className={`supplier-status ${
                    supplier.isActive ? "active" : "inactive"
                  }`}>
                  {translateCurrent(supplier.isActive ? "Active" : "Inactive")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
