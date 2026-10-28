import type * as React from 'react'
import { forwardRef } from 'react'
import { Popover as Primitive } from 'radix-ui'
import { cn } from '@zhin.js/client'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverContent = forwardRef<React.ComponentRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, align = 'start', sideOffset = 8, ...props }, ref) => <Primitive.Portal>
    <Primitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={12}
      className={cn('z-50 rounded-[var(--console-radius-lg)] border bg-popover p-4 text-popover-foreground shadow-lg outline-none', className)} {...props} />
  </Primitive.Portal>,
)
PopoverContent.displayName = 'PopoverContent'
