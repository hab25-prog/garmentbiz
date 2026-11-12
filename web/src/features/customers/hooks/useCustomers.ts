import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersApi } from "../api/customers.api";
import type { CreateCustomerInput } from "../types/customer.types";

export const customerKeys = {
  all: ["customers"] as const,
};

export function useCustomers() {
  return useQuery({
    queryKey: customerKeys.all,
    queryFn: customersApi.getAll,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCustomerInput) => customersApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
