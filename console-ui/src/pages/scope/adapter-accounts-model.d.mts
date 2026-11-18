export declare function hostRendersAccounts(accounts: { readonly state: string } | null | undefined): boolean
export declare const ACCOUNT_LIST_COPY: Readonly<{ host: string; sdk: string }>
export declare const CONNECTION_MANAGER_COPY: Readonly<{ host: string; sdk: string }>
export declare function adapterAccountsView(accounts: { readonly state: string } | null | undefined): Readonly<{
  hostAccounts: boolean
  listDescription: string
  managerHint: string
}>
