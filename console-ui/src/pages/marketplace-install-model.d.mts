import type { ConsoleRpcRequest } from '../utils/console-rpc';
import type { PluginManagementState } from './plugin-management-model.mjs';
export function canResumeInstall(state:PluginManagementState|null,packageName:string,target:{instanceKey:string;version:string}|undefined):boolean;
export function planInstallRecovery(request:(value:ConsoleRpcRequest)=>Promise<unknown>,packageName:string,target:{instanceKey:string;version:string}):Promise<import('./plugin-management-model.mjs').MutationPlan & {requestedSpec:string;targetVersion:string}>;
export function reconcileInstall(packageName:string,readState:()=>Promise<unknown>,target:{instanceKey:string;version:string}):Promise<{state:PluginManagementState|null;confirmed:boolean;message:string}>;
