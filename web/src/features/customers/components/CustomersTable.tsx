import { LocalizedText, translateCurrent } from "../../../app/providers/LanguageProvider";
import { Mail, MapPin, Phone, Users } from "lucide-react";
import type { Customer } from "../types/customer.types";

interface CustomersTableProps {
  customers: Customer[];
  isLoading: boolean;
  onViewReceivables: (customer: Customer) => void;
}

export default function CustomersTable({
  customers,
  isLoading,
  onViewReceivables,
}: CustomersTableProps) {
  return (
    <div className="customer-table-container">
      <table className="customer-table">
        <thead>
          <tr>
            <th><LocalizedText text={"Customer"} /></th>
            <th><LocalizedText text={"Phone"} /></th>
            <th><LocalizedText text={"Email"} /></th>
            <th><LocalizedText text={"Address"} /></th>
            <th><LocalizedText text={"Status"} /></th>
            <th><LocalizedText text={"Receivables"} /></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={6} className="customer-table-message" role="status">
                <LocalizedText text={"\n                Loading customers...\n              "} /></td>
            </tr>
          ) : customers.length === 0 ? (
            <tr>
              <td colSpan={6} className="customer-table-message">
                <div className="customer-empty-icon"><Users size={21} /></div>
                <strong><LocalizedText text={"No customers found"} /></strong>
                <span><LocalizedText text={"Try another search or add a customer to get started."} /></span>
              </td>
            </tr>
          ) : (
            customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <div className="customer-identity">
                    <span className="customer-avatar" aria-hidden="true">
                      {customer.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <strong>{customer.name}</strong>
                  </div>
                </td>
                <td>
                  {customer.phone ? (
                    <span className="customer-contact"><Phone size={14} />{customer.phone}</span>
                  ) : <span className="customer-muted">—</span>}
                </td>
                <td>
                  {customer.email ? (
                    <span className="customer-contact"><Mail size={14} />{customer.email}</span>
                  ) : <span className="customer-muted">—</span>}
                </td>
                <td>
                  {customer.address ? (
                    <span className="customer-contact"><MapPin size={14} />{customer.address}</span>
                  ) : <span className="customer-muted">—</span>}
                </td>
                <td>
                  <span className={`customer-status ${customer.isActive ? "active" : "inactive"}`}>
                    <span />{translateCurrent(customer.isActive ? "Active" : "Inactive")}
                  </span>
                </td>
                <td>
                  <button className="customer-receivables-button" type="button" onClick={() => onViewReceivables(customer)}>
                    <LocalizedText text={"\n                    View receivables\n                  "} /></button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
