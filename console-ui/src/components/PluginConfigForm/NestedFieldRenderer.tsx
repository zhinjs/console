/**
 * Nested field renderer for array items, tuple slots, etc.
 */

import type * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SchemaField } from './types.js'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

interface NestedFieldRendererProps {
  fieldName: string
  field: SchemaField
  value: any
  onChange: (val: any) => void
}

export function NestedFieldRenderer({ field, value, onChange }: NestedFieldRendererProps): React.ReactElement {
  switch (field.type) {
    case 'string':
      return (
        <Input
          value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder={field.description || '请输入'} className="h-8 text-sm"
        />
      )

    case 'number':
    case 'integer':
      return (
        <Input
          type="number" value={value?.toString() || ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder={field.description || '请输入数字'}
          min={field.min} max={field.max} className="h-8 text-sm"
        />
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch checked={value === true} onCheckedChange={onChange} />
          <span className={`text-sm ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            {value ? '已启用' : '已禁用'}
          </span>
        </div>
      )

    case 'object': {
      // Prefer Schema.toJSON `object`, then legacy `dict` / JSON Schema `properties`
      const objectFields = field.object || field.dict || field.properties || {}
      return (
        <Card className="p-2 space-y-2">
          {Object.entries(objectFields).map(([key, nestedField]: [string, any]) => (
            <div key={key} className="space-y-1">
              <span className="text-xs font-semibold">{nestedField.key || key}</span>
              {nestedField.description && (
                <p className="text-xs text-muted-foreground">{nestedField.description}</p>
              )}
              <NestedFieldRenderer
                fieldName={key} field={nestedField} value={value?.[key]}
                onChange={(val) => onChange({ ...(value || {}), [key]: val })}
              />
            </div>
          ))}
        </Card>
      )
    }

    case 'list':
    case 'array': {
      const arrayValue = Array.isArray(value) ? value : []
      const innerField = field.inner || field.items
      // Scalar list: one-per-line textarea
      if (innerField && ['string', 'number', 'integer'].includes(innerField.type)) {
        return (
          <Textarea
            value={arrayValue.join('\n')}
            onChange={(e) => {
              const lines = e.target.value.split('\n').filter(Boolean)
              onChange(
                innerField.type === 'string'
                  ? lines
                  : lines.map((l) => parseFloat(l) || 0),
              )
            }}
            placeholder={`每行一个值\n${field.description || ''}`}
            rows={3}
            className="font-mono text-xs"
          />
        )
      }
      // Complex list: card per item with add / remove
      return (
        <div className="space-y-2">
          {arrayValue.map((item, index) => (
            <Card key={index} className="p-2 space-y-2 group">
              <div className="flex justify-between items-center">
                <Badge variant="secondary" className="font-mono">{index + 1}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive h-7 px-2"
                  onClick={() => onChange(arrayValue.filter((_, i) => i !== index))}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              {innerField ? (
                <NestedFieldRenderer
                  fieldName={`${index}`}
                  field={innerField}
                  value={item}
                  onChange={(val) => {
                    const next = [...arrayValue]
                    next[index] = val
                    onChange(next)
                  }}
                />
              ) : (
                <Textarea
                  value={typeof item === 'object' ? JSON.stringify(item, null, 2) : item ?? ''}
                  onChange={(e) => {
                    const next = [...arrayValue]
                    try { next[index] = JSON.parse(e.target.value) } catch { next[index] = e.target.value }
                    onChange(next)
                  }}
                  rows={2}
                  className="font-mono text-xs"
                />
              )}
            </Card>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed h-8"
            onClick={() => onChange([
              ...arrayValue,
              innerField?.default
                ?? (innerField?.type === 'object' ? {} : innerField?.type === 'list' || innerField?.type === 'array' ? [] : ''),
            ])}
          >
            <Plus className="w-3 h-3 mr-1" /> 添加项
          </Button>
        </div>
      )
    }

    default:
      return (
        <Textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || ''}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) } }}
          rows={3} className="font-mono text-xs"
        />
      )
  }
}
