/**
 * Class name utility — merges Tailwind classes without conflicts.
 * Standard shadcn/ui pattern.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
