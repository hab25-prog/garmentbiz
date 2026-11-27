# Financial dashboard API

`GET /api/dashboard/financial?period=today|week|month|year` requires an authenticated user with an active business membership and the `dashboard.financial.read` permission. `businessId` is always derived from that membership. The period defaults to `month`; periods use Africa/Addis_Ababa calendar boundaries, inclusive at `start` and exclusive at `endExclusive`, with Monday as the start of the week.

All ETB amounts are serialized as decimal strings with two fractional digits. The API keeps separately named figures for invoiced sales, recorded payments, current receivables, received material purchases, operating expenses, and reconciled production material cost. Empty aggregates are returned as `"0.00"`.

## Calculation rules

- Invoiced sales sum `Invoice.totalAmount` for `ISSUED`, `PARTIALLY_PAID`, and `PAID` invoices by `issueDate`.
- Payments received sum `Payment.amount` by `paymentDate`, separately from invoice totals. Payments related to an invoice currently marked `VOID` remain part of recorded receipts and are surfaced in `paymentsLinkedToVoidInvoices`; the application has no refund/reversal ledger to determine whether they were returned to the customer.
- Current outstanding balances are calculated across eligible invoices and all payments for each invoice, independent of the selected period. If an eligible invoice is overpaid, has an invalid amount, or has a balance inconsistent with its status, `totalETB` is `null`, `isComplete` is `false`, and issue counts are returned. The API never reports negative outstanding as a valid total.
- Received material purchases sum `PurchaseItem.totalCost` for `RECEIVED` purchases by `receivedAt`. Legacy received purchases with null `receivedAt` use `purchaseDate`. These are material acquisitions, not supplier cash payments or operating expenses.
- Operating expenses use current, non-voided `Expense` values by `expenseDate`, grouped by category. Salary remains manually recorded. Expense audit history is not a historical financial snapshot.
- Production material cost sums reconciled `ProductionMaterialUsage.totalCost` for non-cancelled batches. Unreconciled usages and active batches with recorded usage are surfaced separately. Returned material is excluded by the production reconciliation calculation. `ProductionCostSheet.materialCost` is not added because it is derived from these usage totals.

These figures are not profit. The current data model does not provide complete labor, overhead allocation, taxes, supplier payment, refund, or payment-reversal accounting. Material purchases and production material consumption are separate accounting events and must not be combined as though they were the same expense.
