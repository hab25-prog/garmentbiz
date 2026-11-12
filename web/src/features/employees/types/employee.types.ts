export interface Employee {
  id: string;
  businessId: string;
  employeeCode: string | null;
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  monthlySalary: string;
  hireDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  fullName: string;
  employeeCode?: string;
  phone?: string;
  jobTitle?: string;
  hireDate?: string;
}
