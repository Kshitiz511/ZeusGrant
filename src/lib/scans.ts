import type { ScanFrequency } from "@/lib/entitlements";

export const SCAN_INTERVAL_DAYS: Record<ScanFrequency, number> = {
  monthly: 30,
  weekly: 7,
  daily: 1,
};

export const SCAN_LABEL: Record<ScanFrequency, string> = {
  monthly: "Monthly funding scan",
  weekly: "Weekly funding scans",
  daily: "Daily funding monitoring",
};

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** When the next automatic scan is due, given the last run. */
export function nextScanAt(lastRunISO: string | null, frequency: ScanFrequency): Date {
  const base = lastRunISO ? new Date(lastRunISO) : new Date(0);
  return addDays(base, SCAN_INTERVAL_DAYS[frequency]);
}

export function scanIsDue(lastRunISO: string | null, frequency: ScanFrequency, now = new Date()): boolean {
  return nextScanAt(lastRunISO, frequency).getTime() <= now.getTime();
}

export function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
