import type * as React from "react"
import { forwardRef } from "react"
import { cn } from "@zhin.js/client"

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "console-control flex min-h-[60px] w-full rounded-[var(--console-radius-md)] border-[length:var(--console-border-width)] border-input bg-card/80 px-3 py-2 text-[length:var(--console-text-body)] shadow-[var(--console-shadow-xs)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
