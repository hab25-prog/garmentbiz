import { addisLocalMidnightAsUtc, type CalendarDate, REPORTING_TIME_ZONE } from "../dashboard/dashboard.service.js";

export const MAX_REPORT_MONTHS = 24;

export class ReportRequestError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ReportRequestError";
  }
}

function leapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDate(value: unknown, name: "from" | "to"): CalendarDate {
  if (typeof value !== "string") throw new ReportRequestError(`${name} is required as YYYY-MM-DD`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ReportRequestError(`${name} must use YYYY-MM-DD format`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new ReportRequestError(`${name} is not a valid calendar date`);
  }
  return { year, month, day };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(0);
  result.setUTCFullYear(date.year, date.month - 1, date.day + days);
  result.setUTCHours(0, 0, 0, 0);
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}

function addMonths(date: CalendarDate, months: number): CalendarDate {
  const absoluteMonth = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

function compareDate(left: CalendarDate, right: CalendarDate) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export function parseReportDateRange(fromValue: unknown, toValue: unknown) {
  const from = parseCalendarDate(fromValue, "from");
  const to = parseCalendarDate(toValue, "to");
  if (compareDate(from, to) > 0) throw new ReportRequestError("from must be on or before to");

  const endExclusiveDate = addDays(to, 1);
  const maximumEndExclusive = addMonths(from, MAX_REPORT_MONTHS);
  if (compareDate(endExclusiveDate, maximumEndExclusive) > 0) {
    throw new ReportRequestError(`Report range cannot exceed ${MAX_REPORT_MONTHS} months`);
  }

  const start = addisLocalMidnightAsUtc(from);
  const endExclusive = addisLocalMidnightAsUtc(endExclusiveDate);
  return {
    from: `${String(from.year).padStart(4, "0")}-${String(from.month).padStart(2, "0")}-${String(from.day).padStart(2, "0")}`,
    to: `${String(to.year).padStart(4, "0")}-${String(to.month).padStart(2, "0")}-${String(to.day).padStart(2, "0")}`,
    timeZone: REPORTING_TIME_ZONE,
    start,
    endExclusive,
  };
}
