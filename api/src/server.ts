import express from "express";
import cors from "cors";
import { isIP } from "node:net";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import materialsRoutes from "./modules/materials/materials.routes.js";
import suppliersRoutes from "./modules/suppliers/suppliers.routes.js";
import purchasesRoutes from "./modules/purchases/purchases.routes.js";
import customersRoutes from "./modules/customers/customers.routes.js";
import employeesRoutes from "./modules/employees/employees.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import unitsRoutes from "./modules/units/units.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import productionRoutes from "./modules/production/production.routes.js";
import invoicesRoutes from "./modules/invoices/invoices.routes.js";
import expensesRoutes from "./modules/expenses/expenses.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import {
  assertJwtConfiguration,
  getAllowedOrigins,
} from "./modules/auth/auth.security.js";
import { prisma } from "./database/prisma.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const trustedProxyIps = process.env.TRUSTED_PROXY_IPS?.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
if (
  trustedProxyIps?.some((entry) => {
    const [address, prefix, extra] = entry.split("/");
    const version = isIP(address ?? "");
    const maximumPrefix = version === 4 ? 32 : version === 6 ? 128 : 0;
    return (
      maximumPrefix === 0 ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) > maximumPrefix))
    );
  })
) {
  throw new Error(
    "TRUSTED_PROXY_IPS must contain explicit IP addresses or CIDR ranges",
  );
}
app.set("trust proxy", trustedProxyIps?.length ? trustedProxyIps : false);

const allowedOrigins = getAllowedOrigins();
assertJwtConfiguration();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, allowedOrigins.has(origin) ? origin : false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/materials", materialsRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/units", unitsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      message: "GarmentBiz API is running!",
      database: "Connected to Neon PostgreSQL",
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

if (process.env.NODE_ENV === "production") {
  const serverDirectory = dirname(fileURLToPath(import.meta.url));
  const frontendDistCandidates = [
    resolve(serverDirectory, "../../../web/dist"),
    resolve(serverDirectory, "../../web/dist"),
    resolve(process.cwd(), "web/dist"),
    resolve(process.cwd(), "../web/dist"),
  ];
  const defaultFrontendDist = resolve(serverDirectory, "../../../web/dist");
  const frontendDist =
    frontendDistCandidates.find(existsSync) ?? defaultFrontendDist;
  const frontendIndex = resolve(frontendDist, "index.html");

  app.use(express.static(frontendDist));
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(frontendIndex, (error) => {
      if (error) next(error);
    });
  });
}

app.listen(PORT, () => {
  console.log(`GarmentBiz API running at http://localhost:${PORT}`);
});
