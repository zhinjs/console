/** Props for a tab whose content region lives outside its Tabs (see tabPanelProps). */
export function tabTriggerProps(base: string, value: string): { readonly id: string; readonly 'aria-controls': string }
/** Props for the single content region such tabs switch: a tabpanel labelled by the active tab. */
export function tabPanelProps(base: string, active: string): { readonly id: string; readonly role: 'tabpanel'; readonly 'aria-labelledby': string }
