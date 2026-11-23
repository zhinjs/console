/**
 * Tabs whose content cannot sit in a `TabsContent` (the layout puts the switch and the content in
 * different places): Radix would point each tab's `aria-controls` at a panel that never exists. These
 * props link every tab to the one real content region instead, and name that region after the active
 * tab, so screen readers find a tabpanel. The look does not change.
 *
 * `base` is a page-unique prefix (from `useId()`); `value` is the tab's value.
 */
export function tabTriggerProps(base, value) {
  return { id: `${base}-tab-${value}`, 'aria-controls': `${base}-panel` }
}

/** Props for the content region the tabs switch: a tabpanel labelled by the active tab. */
export function tabPanelProps(base, active) {
  return { id: `${base}-panel`, role: 'tabpanel', 'aria-labelledby': `${base}-tab-${active}` }
}
