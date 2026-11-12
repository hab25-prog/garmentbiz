import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeesApi } from "../api/employees.api";
import type { CreateEmployeeInput } from "../types/employee.types";

export const employeeKeys = {
  all: ["employees"] as const,
};

export function useEmployees() {
  return useQuery({
    queryKey: employeeKeys.all,
    queryFn: employeesApi.getAll,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateEmployeeInput) => employeesApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeKeys.all });
    },
  });
}
