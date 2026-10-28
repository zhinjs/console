import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@zhin.js/client"

const buttonVariants = cva(
  "console-control inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--console-radius-md)] text-[length:var(--console-text-body)] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-card hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--console-control-height)] px-4 py-2",
        sm: "h-[var(--console-control-height-sm)] rounded-[var(--console-radius-md)] px-3 text-[length:var(--console-text-caption)]",
        lg: "h-[var(--console-control-height)] rounded-[var(--console-radius-md)] px-8",
        icon: "h-[var(--console-control-height)] w-[var(--console-control-height)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Slot = Radix.Slot.Root

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
