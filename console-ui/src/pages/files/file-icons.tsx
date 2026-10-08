import { File, FileCode } from 'lucide-react'

export function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  const className = 'w-4 h-4 shrink-0 text-muted-foreground'
  return ['ts', 'tsx', 'js', 'jsx'].includes(ext ?? '')
    ? <FileCode className={className} aria-hidden="true" />
    : <File className={className} aria-hidden="true" />
}
