import { Mail, MapPin, Phone, Users } from "lucide-react";
import type { Customer } from "../types/customer.types";

interface CustomersTableProps {
  customers: Customer[];
  isLoading: boolean;
}

export default function CustomersTable({
  customers,
  isLoading,
}: CustomersTableProps) {
  return (
    <div className="customer-table-container">
      <table className="customer-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Address</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={5} className="customer-table-message" role="status">
                Loading customers...
              </td>
            </tr>
          ) : customers.length === 0 ? (
            <tr>
              <td colSpan={5} className="customer-table-message">
                <div className="customer-empty-icon"><Users size={21} /></div>
                <strong>No customers found</strong>
                <span>Try another search or add a customer to get started.</span>
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
                    <span />{customer.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
