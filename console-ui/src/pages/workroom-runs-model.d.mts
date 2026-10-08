type Summary = { projectId: string; runId: string; status: string; counts: { tasks: number; assignments: number; reviewerAssignments: number; sponsorGates: number } };
export function validateRuns(data: unknown): void;
export function validateDetail(data: unknown): void;
export function retainRunDetail<T extends Summary>(current: T | null, summaries: Summary[]): T | null;
export function runTotals(runs: Summary[]): { activeRuns: number; tasks: number; assignments: number; blocked: number };
