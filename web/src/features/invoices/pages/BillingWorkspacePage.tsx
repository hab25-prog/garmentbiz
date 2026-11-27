import { ArrowRight, CreditCard, FileText, Users } from "lucide-react";
import "./billing-workspace.css";
import { useLanguage } from "../../../app/providers/LanguageProvider";

type BillingWorkspace = "Invoices" | "Payments";
type Destination = "Orders" | "Customers";

interface BillingWorkspacePageProps {
  workspace: BillingWorkspace;
  onNavigate: (destination: Destination) => void;
}

export default function BillingWorkspacePage({ workspace, onNavigate }: BillingWorkspacePageProps) {
  const { t } = useLanguage();
  const isInvoices = workspace === "Invoices";

  return (
    <div className="billing-workspace">
      <header className="billing-workspace-heading">
        <div className="billing-workspace-icon" aria-hidden="true">
          {isInvoices ? <FileText size={22} /> : <CreditCard size={22} />}
        </div>
        <div>
          <p className="billing-workspace-eyebrow">{t("FINANCE")}</p>
          <h1>{t(isInvoices ? "Invoices" : "Payments")}</h1>
          <p>{t(isInvoices ? "Create and manage invoices from customer orders." : "Record and follow customer payments.")}</p>
        </div>
      </header>

      {isInvoices ? (
        <section className="billing-guidance-card" aria-labelledby="invoice-workflow-title">
          <span className="billing-guidance-mark"><FileText size={19} /></span>
          <div className="billing-guidance-copy">
            <h2 id="invoice-workflow-title">{t("Invoices start with an order")}</h2>
            <p>{t("Open an order’s Details to create its invoice, review the saved line-item snapshot, issue a draft, and check its status and payment information.")}</p>
          </div>
          <button type="button" className="billing-primary-action" onClick={() => onNavigate("Orders")}>
            {t("Go to Orders")} <ArrowRight size={16} />
          </button>
        </section>
      ) : (
        <>
          <section className="billing-guidance-card" aria-labelledby="payment-workflow-title">
            <span className="billing-guidance-mark"><CreditCard size={19} /></span>
            <div className="billing-guidance-copy">
              <h2 id="payment-workflow-title">{t("Record payments against issued invoices")}</h2>
              <p>{t("Payments are entered manually. Open an order’s Details to record a partial or full payment and review the invoice’s payment history and outstanding balance.")}</p>
            </div>
            <button type="button" className="billing-primary-action" onClick={() => onNavigate("Orders")}>
              {t("Find an invoice")} <ArrowRight size={16} />
            </button>
          </section>
          <section className="billing-guidance-card billing-secondary-card" aria-labelledby="receivables-workflow-title">
            <span className="billing-guidance-mark"><Users size={19} /></span>
            <div className="billing-guidance-copy">
              <h2 id="receivables-workflow-title">{t("Review customer balances")}</h2>
              <p>{t("Open Customer Receivables to see eligible invoices, total invoiced, total paid, and the customer’s outstanding balance.")}</p>
            </div>
            <button type="button" className="billing-secondary-action" onClick={() => onNavigate("Customers")}>
              {t("Go to Customers")} <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}
    </div>
  );
}
