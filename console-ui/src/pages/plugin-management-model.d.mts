export interface PluginManagementState {
  packageName: string; instanceKey: string; installed: boolean; plugin: boolean; declared: boolean; version: string | null; revision: string | null; projectRevision: string;
  status: 'not-installed' | 'installed' | 'declared' | 'missing-config' | 'pending-restart' | 'enabled' | 'degraded'; dependencies: 'unchecked' | 'passed' | 'failed';
  validation: { schemaAvailable?: boolean; valid: boolean; errors: readonly {path:string;message:string}[]; missingEnv: readonly string[] } | null;
  generation: number | null; published: boolean; readiness: 'unknown' | 'ready' | 'pending' | 'degraded'; restartRequired: boolean; disabled: boolean; issues: readonly string[]; verification: 'not-configured' | 'available';
}
export interface VerificationCheck { readonly id:string; readonly title:string; readonly effects:readonly string[]; readonly scope:'local'|'platform' }
export interface VerificationPlan { readonly packageName:string; readonly instanceKey:string; readonly generation:number|null; readonly projectRevision:string; readonly checkRevision:string; readonly checks:readonly VerificationCheck[] }
export interface VerificationResult { packageName:string; instanceKey:string; checkId:string; generation:number|null; current:boolean; status:'passed'|'failed'|'not-configured'; scope:'local'|'platform'|null; summary:string; evidence:readonly string[] }
export interface WorkflowRequest { readonly type:string; readonly [key:string]:unknown }
export interface MutationPlan { packageName:string; instanceKey:string; projectRevision?:string; configurationRevision?:string|null; requestedSpec?:string }
export function validateManagementState(state:unknown, instanceKey?:string, locale?: 'zh-CN' | 'en'):PluginManagementState;
export function managementLabel(state?:PluginManagementState|null, locale?: 'zh-CN' | 'en'):string;
export function canApplyPlugin(state?:PluginManagementState|null,currentPlan?:unknown):boolean;
export function canVerifyPlugin(state?:PluginManagementState|null,currentPlan?:unknown):boolean;
export function captureVerificationPlan(plan:unknown,state:PluginManagementState, locale?: 'zh-CN' | 'en'):VerificationPlan;
export function verificationRequest(plan:VerificationPlan,checkId:string,state:PluginManagementState, locale?: 'zh-CN' | 'en'):WorkflowRequest;
export function verifyApprovedPlugin(request:(request:WorkflowRequest)=>Promise<unknown>,plan:VerificationPlan,checkId:string,state:PluginManagementState, locale?: 'zh-CN' | 'en'):Promise<VerificationResult>;
export function verificationSummary(result:VerificationResult|null, locale?: 'zh-CN' | 'en'):string;
export function mutationRequest(type:string,plan:MutationPlan,extra?:Readonly<Record<string,unknown>>, locale?: 'zh-CN' | 'en'):WorkflowRequest;
export function applyRequest(state:PluginManagementState, locale?: 'zh-CN' | 'en'):WorkflowRequest;
export function waitForManagementState(read:()=>Promise<unknown>,previous:PluginManagementState,signal:AbortSignal,options?:{attempts?:number;pause?:(ms:number,signal?:AbortSignal)=>Promise<void>}, locale?: 'zh-CN' | 'en'):Promise<PluginManagementState|null>;
export function waitForEnabledManagementState(read:()=>Promise<unknown>,previous:PluginManagementState,enabled:boolean,signal:AbortSignal,options?:{attempts?:number;pause?:(ms:number,signal?:AbortSignal)=>Promise<void>}, locale?: 'zh-CN' | 'en'):Promise<PluginManagementState|null>;
export function verificationIsCurrent(result:VerificationResult|null,plan:VerificationPlan|null,state?:PluginManagementState|null,currentPlan?:unknown, locale?: 'zh-CN' | 'en'):boolean;
