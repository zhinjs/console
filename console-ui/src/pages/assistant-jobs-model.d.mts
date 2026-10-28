export interface AssistantJob { id: string; label?: string; enabled: boolean; createdAt?: number; state: { lastStatus?: string; lastError?: string; nextRunAtMs?: number }; [key: string]: unknown }
export interface AssistantJobsResponse { jobs: AssistantJob[]; eventsActive: boolean }
export function validateAssistantJobs(body: unknown, locale?: 'zh-CN' | 'en'): AssistantJobsResponse;
export function filterAssistantJobs(jobs: AssistantJob[], query: string, status: string): AssistantJob[];
export function probeAssistantJobs(fetchJobs: () => Promise<{ ok: boolean; json(): Promise<unknown> }>, locale?: 'zh-CN' | 'en'): Promise<boolean>;
export function explainJobError(error: string | undefined, locale?: 'zh-CN' | 'en'): string | null;
