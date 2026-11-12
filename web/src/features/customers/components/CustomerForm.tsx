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
          <h2>New customer</h2>
          <p>Add contact information for a customer.</p>
        </div>
      </div>

      <div className="customer-form-grid">
        <label>
          Customer name <span aria-hidden="true">*</span>
          <input
            autoFocus
            required
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Enter customer name"
          />
        </label>
        <label>
          Phone number
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+251..."
          />
        </label>
        <label>
          Email address
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="customer@example.com"
          />
        </label>
        <label>
          Address
          <input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            placeholder="Customer location"
          />
        </label>
        <label className="customer-full-width">
          Notes
          <textarea
            rows={3}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            placeholder="Additional customer information"
          />
        </label>
      </div>

      <div className="customer-form-actions">
        <button
          type="button"
          className="customer-secondary-button"
          onClick={onCancel}
          disabled={isSubmitting}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !form.name.trim()}>
          {isSubmitting ? "Saving..." : "Save customer"}
        </button>
      </div>
    </form>
  );
}
