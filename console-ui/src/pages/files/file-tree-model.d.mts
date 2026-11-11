import type { FileTreeNode } from '@zhin.js/client'

export type TreePathStatus = 'found' | 'directory' | 'beyond-tree' | 'missing'
export interface TreePathLocation { status: TreePathStatus; ancestors: string[] }
export function normalizeTreePath(path: string): string
export function locateTreePath(tree: readonly FileTreeNode[], path: string): TreePathLocation
export function searchTreeFiles(tree: readonly FileTreeNode[], query: string, limit?: number): { matches: FileTreeNode[]; total: number }
