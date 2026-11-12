export declare const INSTANCE_SECTION_IDS: Readonly<{ status: 'instance-status'; logs: 'instance-logs'; dependencies: 'instance-dependencies' }>
export function instanceSectionHref(section?: keyof typeof INSTANCE_SECTION_IDS, base?: string): string
