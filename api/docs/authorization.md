# Backend authorization

Authorization policy is centralized in `src/authorization/permissions.ts`; route middleware is in `src/middleware/authorization.middleware.ts`.

## Define a permission

Add the permission string to `PERMISSIONS`, then add it to the appropriate `ROLE_PERMISSIONS` entries. Treat this mapping as the server policy source. Sensitive permissions may need a dedicated grant-backed check rather than a role default.

## Protect a route

Business routes must first run `authenticate` and `requireActiveBusinessMembership`. Then add a role or permission middleware to the route, while retaining `requireCsrf` on mutations:

```ts
router.post(
  "/example",
  requireCsrf,
  requirePermission("example.manage"),
  controller,
);
```

Middleware uses the authenticated principal and database-resolved active membership. Never authorize using a body, query, or frontend role value. `assertRequestedBusiness` remains an independent business-isolation check.

## Sensitive response data

Financial read permissions are limited to OWNER, ADMIN, and ACCOUNTANT. Operational order and production responses must remove monetary fields for other roles, including nested product prices, production costs, and inventory valuations. Employee management is limited to OWNER and ADMIN. Operational roster reads expose only employee ID, name, code, job title, and active state; compensation, phone, and hire-date fields are excluded. Nested operational employee data must not include `monthlySalary` outside OWNER/ADMIN responses.

## Protect a sensitive service operation

For sensitive transactional operations, re-read the actor's active membership and current role inside the transaction, then apply the same permission policy before writing. Route middleware is not a replacement for transaction-level checks when membership state or grants can change concurrently.

## Inventory adjustment grants

OWNER and ADMIN have the base adjustment capability and the `inventory.adjust.grant` capability. MANAGER and INVENTORY_MANAGER are denied unless an injected `InventoryAdjustmentGrantStore` confirms an active grant for the authenticated business and membership. No grant is inferred from a role name. The store interface is intentionally not backed by Prisma in this stage; persistence requires a separately approved schema/migration decision.

No grant store is currently configured on the inventory adjustment routes, so only OWNER and ADMIN can adjust stock. All other roles fail closed.

## Frontend role checks

Frontend visibility improves usability but cannot protect data or operations. Clients can call API endpoints directly, so authorization must be enforced in backend middleware and, where necessary, again in services and transactions.
