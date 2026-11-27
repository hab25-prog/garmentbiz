import { useSyncExternalStore } from "react";
import {
  parsePendingPaymentSnapshot,
  pendingPaymentSnapshot,
  subscribeToPendingPayment,
} from "../utils/payment-retry-storage";

export function usePendingPaymentStorage(invoiceId: string | null) {
  const snapshot = useSyncExternalStore(
    (listener) => subscribeToPendingPayment(listener),
    () => pendingPaymentSnapshot(invoiceId),
    () => "__none__",
  );
  return parsePendingPaymentSnapshot(snapshot);
}
