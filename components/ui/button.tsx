import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex min-h-11 w-fit items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  { variants: { variant: {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card text-foreground hover:bg-muted",
  } }, defaultVariants: { variant: "default" } },
);

export function Button({ className, variant, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />;
}
