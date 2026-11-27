const financialFieldNames = new Set([
  "amount",
  "actualMaterialCost",
  "actualCostPerUnit",
  "averageUnitPrice",
  "basePrice",
  "breakEvenUnitPrice",
  "estimatedCost",
  "estimatedCostPerUnit",
  "estimatedMaterialCost",
  "estimatedVsActualMaterialCost",
  "inventoryValue",
  "laborCost",
  "lineTotal",
  "markupAmount",
  "markupPercent",
  "materialCost",
  "totalMaterialCost",
  "minimumOrderPrice",
  "otherDirectCost",
  "outstandingBalance",
  "paidAmount",
  "paymentAmount",
  "suggestedUnitPrice",
  "productionActualMaterialCost",
  "totalAmount",
  "total",
  "totalDirectCost",
  "totalInvoiced",
  "totalOutstanding",
  "totalPaid",
  "totalReconciledMaterialCost",
  "totalCost",
  "comparisonVariance",
  "snapshotCost",
  "unitCost",
  "unitCostSnapshot",
  "unitPrice",
  "variance",
  "variancePercent",
]);

/** Remove monetary/cost fields from JSON-shaped API data for operational-only roles. */
export function redactFinancialFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactFinancialFields(entry)) as T;
  }
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!financialFieldNames.has(key)) redacted[key] = redactFinancialFields(entry);
  }
  return redacted as T;
}

const operationalEmployeeFields = new Set(["id", "fullName", "employeeCode", "jobTitle", "isActive"]);

/** Restrict nested employee relations to the minimal operational roster for non-owner/admin responses. */
export function restrictNestedEmployeeDetails<T>(value: T): T {
  if (Array.isArray(value)) return value.map(restrictNestedEmployeeDetails) as T;
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "employee" && entry !== null && typeof entry === "object" && !Array.isArray(entry) && Object.getPrototypeOf(entry) === Object.prototype) {
      redacted.employee = Object.fromEntries(Object.entries(entry).filter(([field]) => operationalEmployeeFields.has(field)));
    } else {
      redacted[key] = restrictNestedEmployeeDetails(entry);
    }
  }
  return redacted as T;
}
