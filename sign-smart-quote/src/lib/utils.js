import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

// type="number" fields sometimes reject a typed "." depending on keyboard layout.
// Use with type="text" inputMode="decimal" instead: digits + one decimal point only.
export const sanitizeDecimal = (raw) => raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
