import type * as React from "react"
import { cn } from "@zhin.js/client"

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("console-skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
