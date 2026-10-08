export interface AssistantJob { id: string; label?: string; enabled: boolean; createdAt?: number; state: { lastStatus?: string; lastError?: string; nextRunAtMs?: number }; [key: string]: unknown }
export interface AssistantJobsResponse { jobs: AssistantJob[]; eventsActive: boolean }
export function validateAssistantJobs(body: unknown): AssistantJobsResponse;
export function filterAssistantJobs(jobs: AssistantJob[], query: string, status: string): AssistantJob[];
export function probeAssistantJobs(fetchJobs: () => Promise<{ ok: boolean; json(): Promise<unknown> }>): Promise<boolean>;
