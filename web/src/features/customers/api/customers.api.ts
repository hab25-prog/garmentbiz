import { apiClient } from "../../../lib/api-client";
import { fetchCsrfToken } from "../../auth/api/auth.api";
import type { CreateCustomerInput, Customer } from "../types/customer.types";

export const customersApi = {
  getAll(): Promise<Customer[]> {
    return apiClient.get<Customer[]>("/api/customers");
  },

  async create(input: CreateCustomerInput): Promise<Customer> {
    const token = await fetchCsrfToken();

    return apiClient.post<Customer>("/api/customers", input, {
      credentials: "include",
      headers: {
        "X-CSRF-Token": token,
      },
    });
  },
};