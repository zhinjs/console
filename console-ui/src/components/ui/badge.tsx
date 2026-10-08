import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@zhin.js/client"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-[length:var(--console-border-width)] px-2.5 py-0.5 text-[length:var(--console-text-label)] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-[var(--console-shadow-xs)]",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow-[var(--console-shadow-xs)]",
        outline: "text-foreground",
        success: "console-badge-success",
        warning: "console-badge-warning",
        info: "console-badge-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type BadgeProps = React.ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
