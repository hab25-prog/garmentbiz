import { Package, Tag } from "lucide-react";
import type { Product } from "../types/product.types";

interface ProductsTableProps {
  products: Product[];
  isLoading: boolean;
}

function formatEtbPrice(value: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `ETB ${amount.toLocaleString("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ProductsTable({ products, isLoading }: ProductsTableProps) {
  return (
    <div className="product-table-container">
      <table className="product-table">
        <thead>
          <tr><th>Product</th><th>SKU</th><th>Category</th><th>Base selling price</th><th>Status</th></tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5} className="product-table-message" role="status">Loading products...</td></tr>
          ) : products.length === 0 ? (
            <tr>
              <td colSpan={5} className="product-table-message">
                <div className="product-empty-icon"><Package size={21} /></div>
                <strong>No products found</strong>
                <span>Try another search or add a product to the catalog.</span>
              </td>
            </tr>
          ) : products.map((product) => (
            <tr key={product.id}>
              <td>
                <div className="product-identity">
                  <span className="product-avatar" aria-hidden="true"><Package size={16} /></span>
                  <div><strong>{product.name}</strong>{product.description && <span>{product.description}</span>}</div>
                </div>
              </td>
              <td>{product.sku || <span className="product-muted">—</span>}</td>
              <td>{product.category ? <span className="product-category"><Tag size={13} />{product.category}</span> : <span className="product-muted">—</span>}</td>
              <td><strong className="product-price">{formatEtbPrice(product.basePrice)}</strong></td>
              <td><span className={`product-status ${product.isActive ? "active" : "inactive"}`}><span />{product.isActive ? "Active" : "Inactive"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
