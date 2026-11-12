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
  Plus,
  ArrowUpRight,
} from "lucide-react";
import "./App.css";
import MaterialsPage from "./features/materials/pages/MaterialsPage";
import SuppliersPage from "./features/suppliers/pages/SuppliersPage";
import PurchasesPage from "./features/purchases/pages/PurchasesPage";
import CustomersPage from "./features/customers/pages/CustomersPage";
import EmployeesPage from "./features/employees/pages/EmployeesPage";
import ProductsPage from "./features/products/pages/ProductsPage";
import ProtectedRoute from "./features/auth/components/ProtectedRoute";
import { useAuth } from "./features/auth/context/AuthProvider";
import LoginPage from "./features/auth/pages/LoginPage";
import RegisterPage from "./features/auth/pages/RegisterPage";
import Loader from "./features/auth/components/Loader";
const navigation = [
  { title: "MAIN MENU" },
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Customers", icon: Users },
  { name: "Employees", icon: UserRound },
  { name: "Suppliers", icon: Truck },
  { name: "Products", icon: Package },
  { title: "INVENTORY" },
  { name: "Materials", icon: Boxes },
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
  const [activePage, setActivePage] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <div className={`app-shell ${darkMode ? "dark" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="brand">
          <div className="brand-logo">G</div>
          {sidebarOpen && (
            <div>
              <h2>GarmentBiz</h2>
              <span>ETHIOPIA</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navigation.map((item, index) =>
            "title" in item ? (
              sidebarOpen && (
                <div className="nav-heading" key={index}>
                  {item.title}
                </div>
              )
            ) : (
              <button
                key={item.name}
                className={`nav-item ${activePage === item.name ? "active" : ""}`}
                onClick={() => setActivePage(item.name)}
                title={item.name}>
                <item.icon size={19} />
                {sidebarOpen && <span>{item.name}</span>}
              </button>
            ),
          )}
        </nav>

        {sidebarOpen && (
          <div className="sidebar-footer">
            <div className="business-avatar">GB</div>
            <div>
              <strong>{membership?.business.name}</strong>
              <span>Business account</span>
            </div>
          </div>
        )}
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={21} />
          </button>

          <div className="breadcrumb">
            GarmentBiz / <strong>{activePage}</strong>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={17} />
              <input placeholder="Search anything..." />
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
                <span>{membership?.role}</span>
              </div>
              <ChevronDown size={16} />
              <button
                className="text-button"
                onClick={() => { void logout().catch(() => undefined); }}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <section className="page-content">
          {activePage === "Dashboard" ? (
            <Dashboard />
          ) : activePage === "Customers" ? (
            <CustomersPage />
          ) : activePage === "Employees" ? (
            <EmployeesPage />
          ) : activePage === "Products" ? (
            <ProductsPage />
          ) : activePage === "Materials" ? (
            <MaterialsPage />
          ) : activePage === "Suppliers" ? (
            <SuppliersPage />
          ) : activePage === "Purchases" ? (
            <PurchasesPage />
          ) : (
            <div className="page-placeholder">
              <div className="page-icon">
                <Package size={28} />
              </div>
              <h2>{activePage}</h2>
              <p>This section will be connected to the GarmentBiz database.</p>
              <span>Module under development</span>
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

function Dashboard() {
  const stats = [
    {
      label: "Total Revenue",
      value: "ETB 0.00",
      change: "Demo data",
      icon: Wallet,
    },
    {
      label: "Active Orders",
      value: "0",
      change: "Orders in progress",
      icon: ClipboardList,
    },
    {
      label: "Total Customers",
      value: "0",
      change: "Registered customers",
      icon: Users,
    },
    {
      label: "Inventory Items",
      value: "0",
      change: "Material records",
      icon: Boxes,
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back! Here's what's happening in your workshop.</p>
        </div>
        <button className="primary-button">
          <Plus size={18} /> New Order
        </button>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <div className="stat-icon">
                <stat.icon size={20} />
              </div>
            </div>
            <h2>{stat.value}</h2>
            <div className="stat-caption">{stat.change}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="panel overview-panel">
          <div className="panel-heading">
            <div>
              <h3>Business Overview</h3>
              <p>Monitor your workshop performance</p>
            </div>
            <button className="small-select">
              This month <ChevronDown size={14} />
            </button>
          </div>
          <div className="empty-chart">
            <BarChart3 size={42} />
            <strong>No revenue data yet</strong>
            <span>
              Business activity will appear here as you record transactions.
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <h3>Quick Actions</h3>
              <p>Common workshop activities</p>
            </div>
          </div>
          <div className="quick-actions">
            {[
              ["Add Material", Boxes],
              ["Record Purchase", ShoppingCart],
              ["Create Order", ClipboardList],
              ["Record Expense", Wallet],
            ].map(([label, Icon]) => {
              const ActionIcon = Icon as typeof Package;
              return (
                <button className="quick-action" key={label as string}>
                  <ActionIcon size={19} />
                  <span>{label as string}</span>
                  <ArrowUpRight size={16} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel activity-panel">
        <div className="panel-heading">
          <div>
            <h3>Recent Activity</h3>
            <p>Your latest workshop transactions</p>
          </div>
          <button className="text-button">
            View all <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="empty-activity">
          <ClipboardList size={30} />
          <span>No activity recorded yet.</span>
        </div>
      </div>

      <div className="demo-notice">
        <strong>Demo environment</strong>
        <span>
          Dashboard figures are placeholders. We will connect real business data
          in the next steps.
        </span>
      </div>
    </>
  );
}

export default App;
