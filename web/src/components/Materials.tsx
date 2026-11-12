import { useEffect, useState } from "react";
import { Plus, Search, RefreshCw, Package } from "lucide-react";
import "./Materials.css";

interface Material {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  description: string | null;
  reorderLevel: string;
  availableStock: string;
  unit: {
    name: string;
    code: string;
  };
}

const API_URL = import.meta.env.VITE_API_URL;
const BUSINESS_ID = import.meta.env.VITE_BUSINESS_ID;
const METER_UNIT_ID = import.meta.env.VITE_METER_UNIT_ID;

export default function Materials() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [type, setType] = useState("FABRIC");
  const [reorderLevel, setReorderLevel] = useState("0");

  async function loadMaterials() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/materials?businessId=${encodeURIComponent(BUSINESS_ID)}`,
      );

      if (!response.ok) {
        throw new Error("Could not load materials.");
      }

      const result = await response.json();
      setMaterials(result.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMaterials();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/materials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessId: BUSINESS_ID,
          unitId: METER_UNIT_ID,
          name,
          sku: sku || undefined,
          type,
          reorderLevel: Number(reorderLevel),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Could not create material.");
      }

      setName("");
      setSku("");
      setType("FABRIC");
      setReorderLevel("0");
      setShowForm(false);

      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save material.");
    } finally {
      setSaving(false);
    }
  }

  const filteredMaterials = materials.filter((material) =>
    `${material.name} ${material.sku ?? ""} ${material.type}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div className="materials-page">
      <div className="materials-heading">
        <div>
          <h1>Materials</h1>
          <p>Manage your raw materials and inventory records.</p>
        </div>

        <button
          className="primary-button"
          onClick={() => setShowForm(!showForm)}>
          <Plus size={18} />
          Add Material
        </button>
      </div>

      {error && <div className="materials-error">{error}</div>}

      {showForm && (
        <form className="material-form" onSubmit={handleSubmit}>
          <h3>Register New Material</h3>

          <div className="material-form-grid">
            <label>
              Material Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cotton Fabric"
              />
            </label>

            <label>
              SKU
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. FAB-002"
              />
            </label>

            <label>
              Material Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="FABRIC">Fabric</option>
                <option value="POLYMER">Polymer</option>
                <option value="THREAD">Thread</option>
                <option value="ACCESSORY">Accessory</option>
                <option value="PACKAGING">Packaging</option>
                <option value="OTHER">Other</option>
              </select>
            </label>

            <label>
              Reorder Level (meters)
              <input
                type="number"
                min="0"
                step="0.01"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
              />
            </label>
          </div>

          <div className="material-form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? "Saving..." : "Save Material"}
            </button>
          </div>
        </form>
      )}

      <div className="materials-toolbar">
        <div className="materials-search">
          <Search size={17} />
          <input
            placeholder="Search materials..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          className="refresh-button"
          onClick={loadMaterials}
          disabled={loading}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="materials-table-wrap">
        <table className="materials-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>SKU</th>
              <th>Type</th>
              <th>Available Stock</th>
              <th>Reorder Level</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="table-message">
                  Loading materials...
                </td>
              </tr>
            ) : filteredMaterials.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-message">
                  No materials found.
                </td>
              </tr>
            ) : (
              filteredMaterials.map((material) => {
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
                        className={`stock-status ${lowStock ? "low" : "normal"}`}>
                        {lowStock ? "Low Stock" : "In Stock"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="materials-count">
        Showing {filteredMaterials.length} of {materials.length} materials
      </p>
    </div>
  );
}
