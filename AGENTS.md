# GarmentBiz Ethiopia — AI Coding Instructions

## 1. Project Overview

GarmentBiz Ethiopia is an offline-first garment manufacturing management system designed for small garment workshops and manufacturing businesses in Ethiopia.

The current version is an online demo using Neon PostgreSQL. Offline functionality and synchronization are future development goals.

Currency: ETB
Timezone: Africa/Addis_Ababa

## 2. Technology Stack

### Backend

- Node.js
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL (Neon for the demo)

### Frontend

- React
- TypeScript
- Vite
- React Query (@tanstack/react-query)
- CSS

Use the existing dependencies and project configuration. Do not introduce new libraries without a clear reason and approval.

## 3. Development Workflow

Work on ONE module at a time.

For each module:

1. Inspect the existing project structure and relevant Prisma models.
2. Understand the business requirements and existing implementation patterns.
3. Implement the backend first.
4. Build and verify the backend.
5. Implement the frontend.
6. Integrate the frontend with the backend using React Query.
7. Connect the module to the existing application navigation.
8. Build and verify the frontend.
9. Report changed files, implemented functionality, build results and any remaining issues.
10. STOP and wait for user approval before starting another module.

Do not implement multiple modules in one task.

## 4. Architecture Rules

### Backend

- Organize code by business feature/module.
- Separate routes, controllers and services.
- Keep business logic inside services.
- Validate all incoming request data.
- Use consistent API response formats.
- Use Prisma transactions for operations that must succeed or fail together.
- Use Prisma Decimal for monetary and precise quantity calculations.
- Never trust client-supplied business IDs in production.
- Validate that related records belong to the same business.

### Frontend

- Organize code by feature.
- Separate API functions, types, React Query hooks, components and pages.
- Use React Query for all server state.
- Do not make direct API requests inside UI components.
- Reuse existing components, styling conventions and API client.
- Provide loading, error, empty and success states.
- Ensure forms validate input before submission.
- Keep the interface responsive and consistent with existing modules.

## 5. Business Rules

- All business records must be isolated by businessId.
- Currency is ETB.
- Never use JavaScript floating-point arithmetic for authoritative financial calculations.
- Inventory quantities must be calculated from stock movements.
- Do not directly update a material's stock quantity.
- Incoming stock movements are positive.
- Outgoing stock movements are negative.
- Production material accounting must follow:

  Issued quantity = Consumed quantity + Returned quantity + Wasted quantity.

- Purchase records must not increase stock until received.
- Receiving a purchase must update its status and create stock movements and cost records atomically.
- Keep direct production costs separate from fixed business overhead.
- Do not claim FIFO costing unless an actual FIFO allocation implementation exists.

## 6. Database Protection

- Inspect the existing Prisma schema before implementation.
- Never change or delete existing models, fields, enums or migrations without explaining the reason and obtaining approval.
- Do not reset, drop or truncate the database.
- Do not run destructive Prisma commands.
- Do not expose environment variables, database credentials or secrets.
- Do not modify .env files.

## 7. Existing Completed Modules

These modules have already been implemented:

- Materials — backend and frontend.
- Suppliers — backend and frontend.
- Purchases — backend and frontend.

Do not rewrite, replace or unnecessarily modify these modules.

Only modify an existing module when required for the current task and explain the reason.

## 8. Code Quality

- Use TypeScript throughout.
- Avoid `any`.
- Use meaningful file names and variable names.
- Avoid unnecessary abstractions.
- Follow existing project conventions.
- Handle errors properly.
- Do not create fake business records or present mock data as real data.
- Do not leave unfinished placeholder implementations.

## 9. Git and Change Safety

- Inspect git status before making changes.
- Never discard existing user changes.
- Do not commit, push or delete files unless explicitly requested.
- Keep changes limited to the assigned module.
- Report every file created, changed or deleted.

## 10. Communication Rules

Before coding, briefly explain what you plan to implement.

If an important business requirement is unclear, ask before making assumptions.

After implementation:

- Run the relevant build.
- Fix errors caused by your changes.
- Report test results honestly.
- Explain any manual testing still required.
- Stop and wait for approval.

Never move to another module without explicit user approval.
