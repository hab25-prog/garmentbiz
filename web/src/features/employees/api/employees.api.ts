import { apiClient } from "../../../lib/api-client";
import type { CreateEmployeeInput, Employee } from "../types/employee.types";

export const employeesApi = {
  getAll(): Promise<Employee[]> {
    return apiClient.get<Employee[]>("/api/employees");
  },

  create(input: CreateEmployeeInput): Promise<Employee> {
    return apiClient.post<Employee>("/api/employees", input);
  },
};
