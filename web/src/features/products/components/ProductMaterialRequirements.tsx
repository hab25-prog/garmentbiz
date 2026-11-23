import { useState, type FormEvent } from "react";
import { useBomMaterials, useAddMaterialRequirement, useProductMaterialRequirements, useRemoveMaterialRequirement, useUpdateMaterialRequirement } from "../hooks/useProducts";

interface ProductMaterialRequirementsProps {
  productId: string;
  productName: string;
  onClose: () => void;
}

const quantityPattern = /^\d+(\.\d{1,3})?$/;

export default function ProductMaterialRequirements({ productId, productName, onClose }: ProductMaterialRequirementsProps) {
  const requirementsQuery = useProductMaterialRequirements(productId);
  const materialsQuery = useBomMaterials();
  const add = useAddMaterialRequirement();
  const update = useUpdateMaterialRequirement();
  const remove = useRemoveMaterialRequirement();
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const materials = (materialsQuery.data ?? []).filter((material) => material.isActive !== false);
  const selectedMaterial = materials.find((material) => material.id === materialId);

  function validQuantity(value: string) {
    return quantityPattern.test(value.trim()) && Number(value) > 0;
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setFeedback(""); setValidationError("");
    if (!materialId) { setValidationError("Select a material."); return; }
    if (!validQuantity(quantity)) { setValidationError("Enter a quantity greater than zero with up to three decimal places."); return; }
    try {
      await add.mutateAsync({ productId, materialId, quantityPerUnit: quantity.trim() });
      setMaterialId(""); setQuantity(""); setFeedback("Material requirement added.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add this material requirement."); }
  }

  async function handleUpdate(requirementId: string) {
    const value = edits[requirementId] ?? "";
    setError(""); setFeedback(""); setValidationError("");
    if (!validQuantity(value)) { setValidationError("Enter a quantity greater than zero with up to three decimal places."); return; }
    try {
      await update.mutateAsync({ productId, requirementId, quantityPerUnit: value.trim() });
      setEdits((current) => { const next = { ...current }; delete next[requirementId]; return next; });
      setFeedback("Material requirement updated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this requirement."); }
  }

  async function handleRemove(requirementId: string, name: string) {
    if (!window.confirm(`Remove ${name} from ${productName}'s material requirements?`)) return;
    setError(""); setFeedback("");
    try { await remove.mutateAsync({ productId, requirementId }); setFeedback("Material requirement removed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this requirement."); }
  }

  return (
    <div className="bom-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="bom-dialog" role="dialog" aria-modal="true" aria-labelledby="bom-title">
        <header className="bom-heading"><div><div className="products-eyebrow">PRODUCT SETUP</div><h2 id="bom-title">Material requirements</h2><p>{productName} · quantities are per one finished product and use each material's base unit.</p></div><button type="button" className="product-secondary-button" onClick={onClose}>Close</button></header>
        {feedback && <p className="product-success" role="status">{feedback}</p>}
        {error && <p className="product-error" role="alert">{error}</p>}
        {validationError && <p className="product-error" role="alert">{validationError}</p>}
        {requirementsQuery.isLoading ? <p role="status">Loading material requirements…</p>
          : requirementsQuery.isError ? <p className="product-error" role="alert">{requirementsQuery.error.message}</p>
            : (requirementsQuery.data?.length ?? 0) === 0 ? <div className="bom-empty"><strong>No material requirements configured</strong><span>Add the materials and per-unit quantities needed to make this product.</span></div>
              : <div className="bom-list"><div className="bom-row bom-row-header"><span>Material</span><span>Quantity per product</span><span>Action</span></div>{requirementsQuery.data?.map((requirement) => {
                const value = edits[requirement.id] ?? requirement.quantityPerUnit;
                const changed = edits[requirement.id] !== undefined && edits[requirement.id] !== requirement.quantityPerUnit;
                return <div className="bom-row" key={requirement.id}><strong>{requirement.material.name}<small>{requirement.material.sku || "Material"}</small></strong><label className="bom-quantity"><span className="sr-only">Quantity of {requirement.material.name} per product</span><input inputMode="decimal" value={value} onChange={(event) => setEdits((current) => ({ ...current, [requirement.id]: event.target.value }))} /><span>{requirement.material.unit.code || requirement.material.unit.name}</span></label><div className="bom-actions"><button type="button" className="product-secondary-button" onClick={() => void handleUpdate(requirement.id)} disabled={!changed || update.isPending || remove.isPending}>Save</button><button type="button" className="bom-remove" onClick={() => void handleRemove(requirement.id, requirement.material.name)} disabled={update.isPending || remove.isPending}>Remove</button></div></div>;
              })}</div>}
        {materialsQuery.isError && <p className="product-error" role="alert">Could not load materials: {materialsQuery.error.message}</p>}
        {!materialsQuery.isLoading && materials.length === 0 && <p className="bom-empty">Create an active material before configuring this product's requirements.</p>}
        <form className="bom-add-form" onSubmit={(event) => void handleAdd(event)}>
          <h3>Add a material</h3>
          <label>Material<select value={materialId} onChange={(event) => setMaterialId(event.target.value)} disabled={materialsQuery.isLoading || add.isPending} required><option value="">{materialsQuery.isLoading ? "Loading materials…" : "Select material"}</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name} · {material.unit.code || material.unit.name}</option>)}</select></label>
          <label>Quantity per product <span className="bom-unit-hint">{selectedMaterial ? selectedMaterial.unit.code || selectedMaterial.unit.name : "Base unit"}</span><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="e.g. 1.250" aria-describedby="bom-quantity-help" disabled={add.isPending || materials.length === 0} required /><small id="bom-quantity-help">Use the material's base unit. Up to three decimal places.</small></label>
          <button type="submit" className="primary-button" disabled={add.isPending || materials.length === 0}>{add.isPending ? "Adding…" : "Add requirement"}</button>
        </form>
      </section>
    </div>
  );
}
