import { useState } from "react";
import { Package, Plus, RefreshCw, Search } from "lucide-react";
import ProductForm from "../components/ProductForm";
import ProductsTable from "../components/ProductsTable";
import ProductMaterialRequirements from "../components/ProductMaterialRequirements";
import { useCreateProduct, useProducts } from "../hooks/useProducts";
import type { CreateProductInput } from "../types/product.types";
import type { Product } from "../types/product.types";
import "./Products.css";
import { useLanguage, translateCurrent } from "../../../app/providers/LanguageProvider";

export default function ProductsPage() {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [managingProduct, setManagingProduct] = useState<Product | null>(null);
  const productsQuery = useProducts();
  const createProduct = useCreateProduct();
  const products = productsQuery.data ?? [];

  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.sku ?? ""} ${product.category ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const errorMessage = createProduct.error instanceof Error
    ? createProduct.error.message
    : productsQuery.error instanceof Error
      ? productsQuery.error.message
      : "";

  function handleCreateProduct(input: CreateProductInput) {
    createProduct.mutate(input, { onSuccess: () => setShowForm(false) });
  }

  return (
    <div className="products-page">
      <div className="products-heading">
        <div>
          <div className="products-eyebrow"><Package size={14} /> {t("PRODUCT CATALOG")}</div>
          <h1>{t("Products")}</h1>
          <p>{t("Manage garments and their base selling prices.")}</p>
        </div>
        <button className="primary-button" onClick={() => { createProduct.reset(); setShowForm((current) => !current); }}>
          <Plus size={18} /> {t("Add product")}
        </button>
      </div>

      {createProduct.isSuccess && !showForm && (
        <div className="product-success" role="status">
          {t("Product added to the catalog.")}
          <button onClick={() => createProduct.reset()} aria-label={t("Dismiss success message")}>×</button>
        </div>
      )}
      {errorMessage && <div className="product-error" role="alert">{translateCurrent(errorMessage)}</div>}

      {showForm && <ProductForm isSubmitting={createProduct.isPending} onCancel={() => setShowForm(false)} onSubmit={handleCreateProduct} />}

      <section className="product-directory" aria-label={t("Product catalog")}>
        <div className="product-directory-heading">
          <div>
            <h2>{t("Catalog items")}</h2>
            <p>{products.length} {t(products.length === 1 ? "product" : "products")} · {t("includes active and inactive")}</p>
          </div>
          <div className="product-directory-actions">
            <label className="product-search">
              <Search size={17} />
            <input type="search" placeholder={t("Search name, SKU or category")} value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("Search products by name, SKU or category")} />
            </label>
            <button className="product-refresh" onClick={() => void productsQuery.refetch()} disabled={productsQuery.isFetching} aria-label={translateCurrent("Refresh product catalog")}>
            <RefreshCw size={16} /><span>{t(productsQuery.isFetching ? "Refreshing" : "Refresh")}</span>
            </button>
          </div>
        </div>
        <ProductsTable products={filteredProducts} isLoading={productsQuery.isLoading} onManageRequirements={setManagingProduct} />
        {!productsQuery.isLoading && products.length > 0 && <div className="product-results-count">{t("Showing")} {filteredProducts.length} {t("of")} {products.length} {t("products")}</div>}
      </section>
      {managingProduct && <ProductMaterialRequirements productId={managingProduct.id} productName={managingProduct.name} onClose={() => setManagingProduct(null)} />}
    </div>
  );
}
