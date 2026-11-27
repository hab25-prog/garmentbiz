import type { DashboardPeriod } from "../types/analytics.types";

const timeZone = "Africa/Addis_Ababa";
const periodLabels: Record<DashboardPeriod, string> = { today: "Today", week: "This week", month: "This month", year: "This year" };

function addCalendarDays(date: { year: number; month: number; day: number }, days: number) {
  const value = new Date(0);
  value.setUTCFullYear(date.year, date.month - 1, date.day + days);
  value.setUTCHours(0, 0, 0, 0);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}
function dateKey(date: { year: number; month: number; day: number }) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
function todayInAddis(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function periodDateRange(period: DashboardPeriod, now = new Date()) {
  const today = todayInAddis(now);
  let from = today;
  let to = today;
  if (period === "week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    from = addCalendarDays(today, -((weekday + 6) % 7));
    to = addCalendarDays(from, 6);
  } else if (period === "month") {
    from = { ...today, day: 1 };
  } else if (period === "year") {
    from = { ...today, month: 1, day: 1 };
  }
  return { from: dateKey(from), to: dateKey(to) };
}

export function defaultReportRange(now = new Date()) {
  const today = todayInAddis(now);
  return { from: dateKey({ ...today, day: 1 }), to: dateKey(today) };
}

export function formatETB(amount: string, locale: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return `ETB ${amount}`;
  const negative = match[1] ?? "";
  const whole = BigInt(`${negative}${match[2]}`);
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const formatLocale = locale === "am" ? "am-ET" : "en-ET";
  const groupedWhole = new Intl.NumberFormat(formatLocale).format(whole);
  const parts = new Intl.NumberFormat(formatLocale, { style: "currency", currency: "ETB", minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(0);
  return parts.map((part) => {
    if (part.type === "integer") return groupedWhole;
    if (part.type === "fraction") return fraction;
    return part.value;
  }).join("");
}

export function formatQuantity(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "am" ? "am-ET" : "en-ET", { maximumFractionDigits: 3 }).format(value);
}

export function formatMonth(month: string, locale: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-ET", { month: "short", year: "numeric", timeZone }).format(new Date(Date.UTC(year, monthNumber - 1, 15)));
}

export function formatCalendarDate(date: string, locale: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-ET", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
}

export function dashboardPeriodLabel(period: DashboardPeriod) {
  return periodLabels[period];
}

export function exactRatioPercent(value: string, maximum: string): string {
  const cents = (input: string) => {
    const match = /^\d+(?:\.(\d+))?$/.exec(input);
    if (!match) return 0n;
    const [whole = "0", fraction = ""] = input.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const max = cents(maximum);
  if (max <= 0n) return "0%";
  const basisPoints = cents(value) * 10000n / max;
  return `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, "0")}%`;
}
