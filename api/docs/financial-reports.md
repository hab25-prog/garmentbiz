# Financial report API

All report dates use the `Africa/Addis_Ababa` calendar. `from` and `to` are required `YYYY-MM-DD` values, both inclusive as calendar dates. The database interval is `[local midnight(from), local midnight(day after to))`. A range may cover at most 24 calendar months. Invalid dates, reversed ranges, and longer ranges return HTTP 400.

All endpoints require authentication and an active business membership. The business is derived from that membership; query-string `businessId` values are ignored. `reports.financial.read` is required for financial reports. Current FIFO inventory valuation additionally requires `inventory.costs.read`.

## Endpoints

- `GET /api/reports/financial/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/reports/financial/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=month|category`
- `GET /api/reports/financial/material-purchases?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/reports/financial/production-material-costs?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/reports/financial/inventory-valuation`

Amounts are returned as ETB decimal strings. The summary distinguishes period totals from a current outstanding-balance snapshot. Purchases are received material acquisitions, not supplier cash payments or operating expenses. Production reconciled actual cost uses reconciled `ProductionMaterialUsage.totalCost` only; it excludes cancelled batches and does not add production cost-sheet totals. The report separately labels the `totalCost` attached to unreconciled usage as provisional, outside reconciled actual cost. Active batches are also surfaced as a provisional indicator. Inventory valuation is a current snapshot from remaining open FIFO layers, not cash or a historical valuation. None of these endpoints reports profit or net profit.

Report calculations use current records. In particular, edited expense values do not reconstruct historical expense snapshots; use expense audit history when investigating edits.
