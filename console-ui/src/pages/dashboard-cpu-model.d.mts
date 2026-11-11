export interface CpuSample {
  cpuMicros: number
  uptimeSeconds: number
  pid: number | null
}

export declare function readCpuSample(status: unknown): CpuSample | null
export declare function cpuUsagePercent(previous: CpuSample | null, current: CpuSample | null): number | null
export declare function cpuMeterWidth(percent: number | null): number
