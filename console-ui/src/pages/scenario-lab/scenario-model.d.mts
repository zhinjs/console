export type ScenarioTarget = { endpoint: { id: string; adapter: string }; kind: 'private' | 'group' | 'channel'; id: string; parent?: { kind: 'private' | 'group' | 'channel'; id: string }; threadId?: string }
export type ScenarioSegment = { type: string; data: Record<string, unknown> }
export type Scenario = { schemaVersion: 1; name: string; sourceTarget: ScenarioTarget; sender: { id: string; name?: string; roles?: string[] }; input: string; preview: ScenarioSegment[]; profile: 'text' | 'rich'; fixture?: { syntheticEndpoint: string; config: Record<string, unknown> }; assertions?: { dispatchStatus: 'executed' | 'invalid' | 'denied' | 'unmatched' | 'limited'; deliveries: (string | ScenarioSegment[])[] } }
export const SCENARIO_PROFILES: Readonly<Record<'text' | 'rich', { title: string; policy: Readonly<Record<string, unknown>> }>>
export function readScenarioTarget(value: unknown): ScenarioTarget
export function readScenarioSegments(value: unknown): ScenarioSegment[]
export function readScenario(value: unknown): Scenario
export function readScenarioJson(source: string): Scenario
export function scenarioExportIssues(value: unknown): string[]
export function scenarioJson(value: unknown): string
export function exportScenarioRegression(value: unknown): { scenarioJson: string; testSource: string; readme: string }
export function scenarioPreviewItems(value: unknown, profile: string): { kind: string; text: string; label?: string }[]

export type MarkdownBlock = { kind: string; text?: string; label?: string; language?: string; level?: number; ordered?: boolean; items?: string[]; rows?: string[][] }
export function scenarioMarkdownBlocks(source: string): MarkdownBlock[]
