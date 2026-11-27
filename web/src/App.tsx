import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserRound,
  Truck,
  Package,
  Boxes,
  ShoppingCart,
  ClipboardList,
  Factory,
  Scissors,
  Calculator,
  Wallet,
  FileText,
  CreditCard,
  BarChart3,
  Settings,
  Menu,
  Search,
  Bell,
  Sun,
  Moon,
  ChevronDown,
} from "lucide-react";
import "./App.css";
import MaterialsPage from "./features/materials/pages/MaterialsPage";
import SuppliersPage from "./features/suppliers/pages/SuppliersPage";
import PurchasesPage from "./features/purchases/pages/PurchasesPage";
import CustomersPage from "./features/customers/pages/CustomersPage";
import EmployeesPage from "./features/employees/pages/EmployeesPage";
import AcceptInvitationPage from "./features/employees/pages/AcceptInvitationPage";
import ProductsPage from "./features/products/pages/ProductsPage";
import ProtectedRoute from "./features/auth/components/ProtectedRoute";
import { useAuth } from "./features/auth/context/AuthProvider";
import LoginPage from "./features/auth/pages/LoginPage";
import RegisterPage from "./features/auth/pages/RegisterPage";
import VerifyEmailPage from "./features/auth/pages/VerifyEmailPage";
import Loader from "./features/auth/components/Loader";
import OrdersPage from "./features/orders/pages/OrdersPage";
import ProductionPage from "./features/production/pages/ProductionPage";
import InventoryPage from "./features/inventory/pages/InventoryPage";
import BillingWorkspacePage from "./features/invoices/pages/BillingWorkspacePage";
import ExpensesPage from "./features/expenses/pages/ExpensesPage";
import SettingsPage from "./features/settings/SettingsPage";
import DashboardPage from "./features/analytics/pages/DashboardPage";
import ReportsPage from "./features/analytics/pages/ReportsPage";
import { useLanguage, LocalizedText } from "./app/providers/LanguageProvider";
import garmentbizIcon from "./assets/garmentbiz-icon.svg";
const navigation = [
  { title: "MAIN MENU" },
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Customers", icon: Users },
  { name: "Employees", icon: UserRound },
  { name: "Suppliers", icon: Truck },
  { name: "Products", icon: Package },
  { title: "INVENTORY" },
  { name: "Materials", icon: Boxes },
  { name: "Inventory", icon: ClipboardList },
  { name: "Stock Movements", icon: ClipboardList },
  { name: "Low Stock", icon: BarChart3 },
  { name: "Purchases", icon: ShoppingCart },
  { title: "OPERATIONS" },
  { name: "Orders", icon: ClipboardList },
  { name: "Production Batches", icon: Factory },
  { name: "Material Usage", icon: Scissors },
  { name: "Production Costing", icon: Calculator },
  { title: "FINANCE" },
  { name: "Expenses", icon: Wallet },
  { name: "Salaries", icon: CreditCard },
  { name: "Invoices", icon: FileText },
  { name: "Payments", icon: CreditCard },
  { name: "Reports", icon: BarChart3 },
  { name: "Settings", icon: Settings },
];

function AppShell() {
  const { user, membership, logout } = useAuth();
  const { t } = useLanguage();
  const [activePage, setActivePage] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 801px)").matches,
  );
  const [darkMode, setDarkMode] = useState(false);
  const [openExpenseFormRequest, setOpenExpenseFormRequest] = useState(false);
  const canViewExpenses = ["OWNER", "ADMIN", "ACCOUNTANT", "MANAGER"].includes(membership?.role ?? "");
  const canManageExpenses = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(membership?.role ?? "");

  function navigateToPage(page: string) {
    setActivePage(page);
    if (window.matchMedia("(max-width: 800px)").matches) setSidebarOpen(false);
  }

  function openDashboardExpenseForm() {
    if (!canManageExpenses) return;
    setOpenExpenseFormRequest(true);
    navigateToPage("Expenses");
  }

  return (
    <div className={`app-shell ${darkMode ? "dark" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="brand">
          <div className="brand-logo">
            <img src={garmentbizIcon} alt="" aria-hidden="true" />
          </div>
          {sidebarOpen && (
            <div>
              <h2><LocalizedText text={"GarmentBiz"} /></h2>
              <span><LocalizedText text={"ETHIOPIA"} /></span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navigation.filter((item) => !("name" in item) || item.name !== "Expenses" || canViewExpenses).map((item, index) =>
            "title" in item ? (
              sidebarOpen && (
                <div className="nav-heading" key={index}>
                  {t(item.title ?? "")}
                </div>
              )
            ) : (
              <button
                key={item.name}
                className={`nav-item ${activePage === item.name ? "active" : ""}`}
                onClick={() => navigateToPage(item.name)}
                title={t(item.name)}>
                <item.icon size={19} />
                {sidebarOpen && <span>{t(item.name)}</span>}
              </button>
            ),
          )}
        </nav>

        {sidebarOpen && (
          <div className="sidebar-footer">
            <div className="business-avatar"><LocalizedText text={"GB"} /></div>
            <div>
              <strong>{membership?.business.name}</strong>
              <span>{t("Business account")}</span>
            </div>
          </div>
        )}
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label={t("Close navigation menu")}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={21} aria-hidden="true" />
          </button>

          <div className="breadcrumb">
            <LocalizedText text={"\n            GarmentBiz / "} /><strong>{t(activePage)}</strong>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={17} />
              <input placeholder={t("Search anything...")} aria-label={t("Search anything...")} />
            </div>
            <button
              className="icon-button"
              onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button notification">
              <Bell size={19} />
              <span />
            </button>
            <div className="user-profile">
              <div className="user-avatar">
                {user?.fullName.slice(0, 1).toUpperCase()}
              </div>
              <div className="user-info">
                <strong>{user?.fullName}</strong>
                <span>{t(membership?.role ?? "")}</span>
              </div>
              <ChevronDown size={16} />
              <button
                className="text-button"
                onClick={() => { void logout().catch(() => undefined); }}
              >
                {t("Sign out")}
              </button>
            </div>
          </div>
        </header>

        <section className="page-content">
          {activePage === "Dashboard" ? (
            <DashboardPage role={membership?.role ?? ""} onRecordExpense={openDashboardExpenseForm} onOpenReports={() => navigateToPage("Reports")} />
          ) : activePage === "Customers" ? (
            <CustomersPage />
          ) : activePage === "Employees" ? (
            <EmployeesPage />
          ) : activePage === "Products" ? (
            <ProductsPage />
          ) : activePage === "Materials" ? (
            <MaterialsPage />
          ) : activePage === "Inventory" ? (
            <InventoryPage />
          ) : activePage === "Stock Movements" ? (
            <InventoryPage initialTab="History" />
          ) : activePage === "Suppliers" ? (
            <SuppliersPage />
          ) : activePage === "Purchases" ? (
            <PurchasesPage />
          ) : activePage === "Orders" ? (
            <OrdersPage />
          ) : activePage === "Production Batches" ? (
            <ProductionPage />
          ) : activePage === "Expenses" ? (
            <ExpensesPage
              openCreateFormRequest={openExpenseFormRequest}
              onCreateFormRequestHandled={() => setOpenExpenseFormRequest(false)}
            />
          ) : activePage === "Invoices" || activePage === "Payments" ? (
            <BillingWorkspacePage workspace={activePage} onNavigate={navigateToPage} />
          ) : activePage === "Settings" ? (
            <SettingsPage />
          ) : activePage === "Reports" ? (
            <ReportsPage role={membership?.role ?? ""} />
          ) : (
            <div className="page-placeholder">
              <div className="page-icon">
                <Package size={28} />
              </div>
              <h2>{t(activePage)}</h2>
              <p>{t("This section will be connected to the GarmentBiz database.")}</p>
              <span>{t("Module under development")}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AuthRoute({ mode }: { mode: "login" | "register" }) {
  const { status } = useAuth();

  if (status === "initializing") {
    return <Loader />;
  }
  if (status === "authenticated") return <Navigate to="/app" replace />;
  return mode === "login" ? <LoginPage /> : <RegisterPage />;
}

function HomeRoute() {
  const { status } = useAuth();

  if (status === "initializing") {
    return <Loader />;
  }
  return <Navigate to={status === "authenticated" ? "/app" : "/login"} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthRoute mode="login" />} />
      <Route path="/register" element={<AuthRoute mode="register" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<HomeRoute />} />
      <Route path="*" element={<HomeRoute />} />
    </Routes>
  );
}


export default App;
