import type { ElementType, ReactNode } from 'react'
import { Users } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../../components/ui/sheet'

export interface MemberPanelSlots {
  /** Heading element: the panel title doubles as the drawer's accessible name. */
  Title: ElementType
  Description: ElementType
}

/**
 * Narrow-screen entry to the group member panel: a header button that opens the same panel in a
 * right-side Sheet. Radix provides Esc, overlay click, the close button, `aria-controls` and focus
 * return to the button.
 */
export function GroupMembersDrawer({
  open,
  onOpenChange,
  memberCount,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberCount: number
  children: (slots: MemberPanelSlots) => ReactNode
}) {
  const i18n = useI18n()
  const label = i18n.t("群成员")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="im-header-icon-button im-member-drawer-toggle h-8 gap-1 px-2"
          title={label}
          aria-label={memberCount > 0 ? i18n.t("群成员（{0}）", [memberCount]) : label}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Users className="h-4 w-4" aria-hidden />
          <span className="im-member-drawer-label text-xs">{label}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="im-member-sheet">
        {children({ Title: SheetTitle, Description: SheetDescription })}
      </SheetContent>
    </Sheet>
  )
}
