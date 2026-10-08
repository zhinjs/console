import { useId, type ChangeEvent } from 'react'
import { Input } from '../../components/ui/input'

export function JsonField({ label, value, onChange, disabled, error }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} disabled={disabled} value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} className="font-mono text-xs" />
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
