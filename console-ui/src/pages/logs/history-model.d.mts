import type {LogEntry} from './LogWorkbench'
export interface HistoryQuery {page:number;pageSize:number;level:'all'|'debug'|'info'|'warn'|'error';source:string;q:string}
export interface HistoryPayload {success:true;data:LogEntry[];sources:{source:string;count:number}[];total:number;page:number;pageSize:number;totalPages:number}
export function historyQuery(params:URLSearchParams):HistoryQuery
export function historyParams(query:HistoryQuery):URLSearchParams
export function changeHistoryFilter(params:URLSearchParams,name:string,value:string|number):URLSearchParams
export function validateHistoryResponse(payload:unknown):HistoryPayload
export function selectedHistoryEntry(rows:LogEntry[],selected:LogEntry|null):LogEntry|null

export function isCurrentHistoryRequest(current:{controller:AbortController;key:string}|null,controller:AbortController,key:string):boolean
