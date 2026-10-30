export interface DeploymentPolicyPreset { id: string; modelId: string; model: string; sdk: string }
export interface ModelPolicyRefs { defaults?: {chat?:string;perception?:string;summary?:string}; adapters?:Record<string,{chat?:string;perception?:string}>; endpoints?:Array<{address:{rootId:string;platform:string;endpoint:string;adapterId:string};models:{chat?:string;perception?:string}}>; scenes?:Array<{address:{rootId:string;platform:string;endpoint:string;conversation:import('./endpoint-detail/types').DiagnosticConversation};models:{chat?:string}}> }
export interface RuntimePolicyTargets { adaptersAvailable:boolean; adapters:Array<{capabilityId:string;platform:string}>; endpoints:Array<{capabilityId:string;instanceId:string;address:NonNullable<ModelPolicyRefs['endpoints']>[number]['address']}>; scenesAvailable:boolean;scenesError?:'not_requested'|'unavailable'|'integrity'; scenes:Array<{address:NonNullable<ModelPolicyRefs['scenes']>[number]['address']}>;sceneHasMore:boolean }
export interface ModelPolicyView { revision:number; rootId:string; refsOverride:ModelPolicyRefs; baseline:ModelPolicyRefs; presets:DeploymentPolicyPreset[]; targets?:RuntimePolicyTargets }
export function readModelPolicyRefs(value: unknown): ModelPolicyRefs
export function readModelPolicyView(value: unknown): ModelPolicyView
export function modelPolicyFailure(status?:number,code?:string,writing?:boolean):string
export function policyAddressKey(address:unknown):string
export function selectAgentPreset(agents:Record<string,unknown>,role:string,presetId:string):Record<string,unknown>
export function deploymentPresetChoices(ai:unknown):DeploymentPolicyPreset[]
