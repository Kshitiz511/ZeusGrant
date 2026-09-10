import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional + Tailwind classes (identical to the legacy app's cn). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
