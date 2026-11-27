import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useState, type FormEvent } from "react";
import type { CreateSupplierInput } from "../types/supplier.types";

interface SupplierFormProps {
  onSubmit: (input: CreateSupplierInput) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

export default function SupplierForm({
  onSubmit,
  isSubmitting,
  onCancel,
}: SupplierFormProps) {
  const [form, setForm] = useState<CreateSupplierInput>({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });

  function updateField(field: keyof CreateSupplierInput, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input: CreateSupplierInput = {
      name: form.name.trim(),
      ...(form.contactName?.trim()
        ? { contactName: form.contactName.trim() }
        : {}),
      ...(form.phone?.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.email?.trim() ? { email: form.email.trim() } : {}),
      ...(form.address?.trim() ? { address: form.address.trim() } : {}),
      ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    };

    onSubmit(input);
  }

  return (
    <form className="supplier-form" onSubmit={handleSubmit}>
      <div className="supplier-form-grid">
        <label>
          <LocalizedText text={"\n          Supplier Name *\n          "} /><input
            required
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder={translateCurrent("Enter supplier name")}
          />
        </label>

        <label>
          <LocalizedText text={"\n          Contact Person\n          "} /><input
            value={form.contactName}
            onChange={(event) => updateField("contactName", event.target.value)}
            placeholder={translateCurrent("Enter contact person")}
          />
        </label>

        <label>
          <LocalizedText text={"\n          Phone Number\n          "} /><input
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+251..."
          />
        </label>

        <label>
          <LocalizedText text={"\n          Email Address\n          "} /><input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder={translateCurrent("supplier@example.com")}
          />
        </label>

        <label className="supplier-full-width">
          <LocalizedText text={"\n          Address\n          "} /><input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            placeholder={translateCurrent("Supplier location")}
          />
        </label>

        <label className="supplier-full-width">
          <LocalizedText text={"\n          Notes\n          "} /><textarea
            rows={3}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            placeholder={translateCurrent("Additional information about this supplier")}
          />
        </label>
      </div>

      <div className="supplier-form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          <LocalizedText text={"\n          Cancel\n        "} /></button>

        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !form.name.trim()}>
          {translateCurrent(isSubmitting ? "Saving..." : "Save Supplier")}
        </button>
      </div>
    </form>
  );
}
