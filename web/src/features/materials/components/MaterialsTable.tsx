import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { Package } from "lucide-react";
import type { Material } from "../types/material.types";

interface MaterialsTableProps {
  materials: Material[];
  isLoading: boolean;
  onToggleActive:(id:string,isActive:boolean)=>void;
  onEdit:(material:Material)=>void;
  isUpdating:boolean;
}

export default function MaterialsTable({
  materials,
  isLoading,
  onToggleActive,
  onEdit,
  isUpdating,
}: MaterialsTableProps) {
  return (
    <div className="materials-table-wrap">
      <table className="materials-table">
        <thead>
          <tr>
            <th><LocalizedText text={"Material"} /></th>
            <th><LocalizedText text={"SKU"} /></th>
            <th><LocalizedText text={"Type"} /></th>
            <th><LocalizedText text={"Available Stock"} /></th>
            <th><LocalizedText text={"Reorder Level"} /></th>
            <th><LocalizedText text={"Status"} /></th>
            <th><LocalizedText text={"Action"} /></th>
          </tr>
        </thead>

        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={7} className="table-message">
                <LocalizedText text={"\n                Loading materials...\n              "} /></td>
            </tr>
          ) : materials.length === 0 ? (
            <tr>
              <td colSpan={7} className="table-message">
                <LocalizedText text={"\n                No materials found.\n              "} /></td>
            </tr>
          ) : (
            materials.map((material) => {
              const stock = Number(material.availableStock);
              const reorder = Number(material.reorderLevel);
              const lowStock = stock <= reorder;

              return (
                <tr key={material.id}>
                  <td>
                    <div className="material-name">
                      <div className="material-icon">
                        <Package size={18} />
                      </div>

                      <div>
                        <strong>{material.name}</strong>
                        <span>{material.unit.name}</span>
                      </div>
                    </div>
                  </td>
                  <td>{material.sku || "—"}</td>
                  <td>{material.type}</td>

                  <td>
                    {stock.toLocaleString()} {material.unit.code}
                  </td>

                  <td>
                    {reorder.toLocaleString()} {material.unit.code}
                  </td>

                  <td>
                    <span
                      className={`stock-status ${material.isActive === false ? "low" : lowStock ? "low" : "normal"}`}>
                      {translateCurrent(material.isActive === false ? "Archived" : lowStock ? "Low Stock" : "In Stock")}
                    </span>
                  </td>
                  <td>
                    <button type="button" disabled={isUpdating} onClick={() => onEdit(material)}><LocalizedText text={"Edit"} /></button>{" "}
                    <button type="button" disabled={isUpdating} onClick={() => onToggleActive(material.id,material.isActive!==false)}>{translateCurrent(material.isActive===false?"Restore":"Archive")}</button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
