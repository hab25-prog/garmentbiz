import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { useState, type FormEvent } from "react";
import type { CreateCustomerInput } from "../types/customer.types";

interface CustomerFormProps {
  onSubmit: (input: CreateCustomerInput) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

export default function CustomerForm({
  onSubmit,
  isSubmitting,
  onCancel,
}: CustomerFormProps) {
  const [form, setForm] = useState<CreateCustomerInput>({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });

  function updateField(field: keyof CreateCustomerInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      name: form.name.trim(),
      ...(form.phone?.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.email?.trim() ? { email: form.email.trim() } : {}),
      ...(form.address?.trim() ? { address: form.address.trim() } : {}),
      ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    });
  }

  return (
    <form className="customer-form" onSubmit={handleSubmit}>
      <div className="customer-form-heading">
        <div>
          <h2><LocalizedText text={"New customer"} /></h2>
          <p><LocalizedText text={"Add contact information for a customer."} /></p>
        </div>
      </div>

      <div className="customer-form-grid">
        <label>
          <LocalizedText text={"\n          Customer name "} /><span aria-hidden="true">*</span>
          <input
            autoFocus
            required
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder={translateCurrent("Enter customer name")}
          />
        </label>
        <label>
          <LocalizedText text={"\n          Phone number\n          "} /><input
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+251..."
          />
        </label>
        <label>
          <LocalizedText text={"\n          Email address\n          "} /><input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder={translateCurrent("customer@example.com")}
          />
        </label>
        <label>
          <LocalizedText text={"\n          Address\n          "} /><input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            placeholder={translateCurrent("Customer location")}
          />
        </label>
        <label className="customer-full-width">
          <LocalizedText text={"\n          Notes\n          "} /><textarea
            rows={3}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            placeholder={translateCurrent("Additional customer information")}
          />
        </label>
      </div>

      <div className="customer-form-actions">
        <button
          type="button"
          className="customer-secondary-button"
          onClick={onCancel}
          disabled={isSubmitting}>
          <LocalizedText text={"\n          Cancel\n        "} /></button>
        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !form.name.trim()}>
          {translateCurrent(isSubmitting ? "Saving..." : "Save customer")}
        </button>
      </div>
    </form>
  );
}
