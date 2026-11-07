import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(base, "h-9 py-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(base, "min-h-16 py-2", className)} {...props} />;
}
