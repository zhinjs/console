export type ScenarioTarget = { endpoint: { id: string; adapter: string }; kind: 'private' | 'group' | 'channel'; id: string; parent?: { kind: 'private' | 'group' | 'channel'; id: string }; threadId?: string }
export type ScenarioSegment = { type: string; data: Record<string, unknown> }
export type Scenario = { schemaVersion: 1; name: string; sourceTarget: ScenarioTarget; sender: { id: string; name?: string; roles?: string[] }; input: string; preview: ScenarioSegment[]; profile: 'text' | 'rich'; fixture?: { syntheticEndpoint: string; config: Record<string, unknown> }; assertions?: { dispatchStatus: 'executed' | 'invalid' | 'denied' | 'unmatched' | 'limited'; deliveries: (string | ScenarioSegment[])[] } }
export const SCENARIO_PROFILES: Readonly<Record<'text' | 'rich', { title: string; policy: Readonly<Record<string, unknown>> }>>
export function readScenarioTarget(value: unknown, locale?: 'zh-CN' | 'en'): ScenarioTarget
export function readScenarioSegments(value: unknown, locale?: 'zh-CN' | 'en'): ScenarioSegment[]
export function readScenario(value: unknown, locale?: 'zh-CN' | 'en'): Scenario
export function readScenarioJson(source: string, locale?: 'zh-CN' | 'en'): Scenario
export function scenarioExportIssues(value: unknown, locale?: 'zh-CN' | 'en'): string[]
export function scenarioJson(value: unknown, locale?: 'zh-CN' | 'en'): string
export function exportScenarioRegression(value: unknown, locale?: 'zh-CN' | 'en'): { scenarioJson: string; testSource: string; readme: string }
export function scenarioPreviewItems(value: unknown, profile: string, locale?: 'zh-CN' | 'en'): { kind: string; text: string; label?: string }[]

export type MarkdownBlock = { kind: string; text?: string; label?: string; language?: string; level?: number; ordered?: boolean; items?: string[]; rows?: string[][] }
export function scenarioMarkdownBlocks(source: string, locale?: 'zh-CN' | 'en'): MarkdownBlock[]
