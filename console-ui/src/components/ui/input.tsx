import type * as React from "react"
import { forwardRef } from "react"
import { cn } from "@zhin.js/client"

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "console-control flex h-[var(--console-control-height)] w-full rounded-[var(--console-radius-md)] border-[length:var(--console-border-width)] border-input bg-card/80 px-3 py-1 text-[length:var(--console-text-body)] shadow-[var(--console-shadow-xs)] transition-colors file:border-0 file:bg-transparent file:text-[length:var(--console-text-body)] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
