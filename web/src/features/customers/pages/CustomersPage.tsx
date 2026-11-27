import { useState } from "react";
import { Plus, RefreshCw, Search, Users } from "lucide-react";
import CustomerForm from "../components/CustomerForm";
import CustomersTable from "../components/CustomersTable";
import CustomerReceivablesDialog from "../components/CustomerReceivablesDialog";
import { useCreateCustomer, useCustomers } from "../hooks/useCustomers";
import type { CreateCustomerInput, Customer } from "../types/customer.types";
import "./Customers.css";
import { useLanguage } from "../../../app/providers/LanguageProvider";

export default function CustomersPage() {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [receivablesCustomer, setReceivablesCustomer] = useState<Customer | null>(null);
  const customersQuery = useCustomers();
  const createCustomer = useCreateCustomer();
  const customers = customersQuery.data ?? [];

  const filteredCustomers = customers.filter((customer) =>
    `${customer.name} ${customer.phone ?? ""} ${customer.email ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const errorMessage =
    createCustomer.error instanceof Error
      ? createCustomer.error.message
      : customersQuery.error instanceof Error
        ? customersQuery.error.message
        : "";

  function handleCreateCustomer(input: CreateCustomerInput) {
    createCustomer.mutate(input, {
      onSuccess: () => setShowForm(false),
    });
  }

  return (
    <div className="customers-page">
      <div className="customers-heading">
        <div>
          <div className="customers-eyebrow"><Users size={14} /> {t("CUSTOMER DIRECTORY")}</div>
          <h1>{t("Customers")}</h1>
          <p>{t("Manage your customer contacts and business relationships.")}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            createCustomer.reset();
            setShowForm((current) => !current);
          }}>
          <Plus size={18} /> {t("Add customer")}
        </button>
      </div>

      {createCustomer.isSuccess && !showForm && (
        <div className="customer-success" role="status">
          {t("Customer saved successfully.")}
          <button onClick={() => createCustomer.reset()} aria-label={t("Dismiss success message")}>×</button>
        </div>
      )}
      {errorMessage && <div className="customer-error" role="alert">{t(errorMessage)}</div>}

      {showForm && (
        <CustomerForm
          isSubmitting={createCustomer.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={handleCreateCustomer}
        />
      )}

      <section className="customer-directory" aria-label={t("Customer list")}>
        <div className="customer-directory-heading">
          <div>
            <h2>{t("All customers")}</h2>
            <p>{customers.length} {t(customers.length === 1 ? "contact" : "contacts")} {t("in your directory")}</p>
          </div>
          <div className="customer-directory-actions">
            <label className="customer-search">
              <Search size={17} />
              <input
                type="search"
                placeholder={t("Search name, phone or email")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t("Search customers by name, phone or email")}
              />
            </label>
            <button
              className="customer-refresh"
              onClick={() => void customersQuery.refetch()}
              disabled={customersQuery.isFetching}
              aria-label={t("Refresh customer list")}>
              <RefreshCw size={16} />
              <span>{t(customersQuery.isFetching ? "Refreshing" : "Refresh")}</span>
            </button>
          </div>
        </div>

        <CustomersTable
          customers={filteredCustomers}
          isLoading={customersQuery.isLoading}
          onViewReceivables={setReceivablesCustomer}
        />
        {!customersQuery.isLoading && customers.length > 0 && (
          <div className="customer-results-count">
            {t("Showing")} {filteredCustomers.length} {t("of")} {customers.length} {t("customers")}
          </div>
        )}
      </section>
      {receivablesCustomer && (
        <CustomerReceivablesDialog
          customer={receivablesCustomer}
          onClose={() => setReceivablesCustomer(null)}
        />
      )}
    </div>
  );
}
