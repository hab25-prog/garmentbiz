import { apiClient } from "../../../lib/api-client";
import type { CreateCustomerInput, Customer } from "../types/customer.types";

export const customersApi = {
  getAll(): Promise<Customer[]> {
    return apiClient.get<Customer[]>("/api/customers");
  },

  create(input: CreateCustomerInput): Promise<Customer> {
    return apiClient.post<Customer>("/api/customers", input);
  },
};
