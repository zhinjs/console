import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Checkbox } from '../../components/ui/checkbox'
import type { Driver, Kind, ModelDefinition } from './model.mjs'

interface ModelCapabilitiesProps {
  readonly driver: Driver
  readonly value: ModelDefinition
  readonly onChange: (value: ModelDefinition) => void
}
const kinds: Record<Kind, string> = {
  language: '语言模型',
  decision: '决策模型',
  image: '图像生成',
}
const inputs: Record<string, string> = {
  text: '文字',
  image: '图片',
  audio: '音频',
  video: '视频',
  file: '文件',
}
const booleanFields = { streaming: '流式输出', toolCalling: '工具调用', thinking: '思考' } as const

/** These are explicit capability declarations, never guesses from a model's name or protocol. */
export function ModelCapabilities({ driver, value, onChange }: ModelCapabilitiesProps) {
  const contract = driver.modelContracts.find((item) => item.protocol === value.protocol)
  function booleanValue(key: keyof typeof booleanFields, selected: string) {
    const next = { ...value }
    if (!selected) delete next[key]
    else next[key] = selected === 'true'
    onChange(next)
  }
  return (
    <section className="space-y-4 rounded-md border p-4">
      <h4 className="text-sm font-medium">模型能力</h4>
      <label className="block space-y-2 text-sm">
        <span>协议</span>
        <SelectField
          value={value.protocol}
          onValueChange={(protocol) => onChange({ id: value.id, protocol, kinds: [] })}
          options={[
            { value: '', label: '选择协议' },
            ...driver.modelContracts.map((item) => ({
              value: item.protocol,
              label: item.protocol,
            })),
          ]}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        {(contract?.kinds ?? []).map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.kinds.includes(kind)}
              onCheckedChange={(checked) =>
                onChange({
                  ...value,
                  kinds:
                    checked === true
                      ? [...value.kinds, kind]
                      : value.kinds.filter((item) => item !== kind),
                })
              }
            />
            {kinds[kind]}
          </label>
        ))}
      </div>
      {value.kinds.includes('language') ? (
        <>
          <div className="flex flex-wrap gap-4">
            {Object.entries(inputs).map(([kind, label]) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.input?.includes(kind) ?? false}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      input:
                        checked === true
                          ? [...(value.input ?? []), kind]
                          : value.input?.filter((item) => item !== kind) ?? [],
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(booleanFields).map(([key, label]) => {
              const field = key as keyof typeof booleanFields
              return (
                <label key={key} className="space-y-2 text-sm">
                  <span>{label}</span>
                  <SelectField
                    value={value[field] === undefined ? '' : String(value[field])}
                    onValueChange={(selected) => booleanValue(field, selected)}
                    options={[
                      { value: '', label: '未声明' },
                      { value: 'true', label: '支持' },
                      { value: 'false', label: '不支持' },
                    ]}
                  />
                </label>
              )
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['contextWindow', 'maxOutputTokens'] as const).map((key) => (
              <label key={key} className="space-y-2 text-sm">
                <span>{key === 'contextWindow' ? '上下文容量' : '最大输出容量'}（tokens）</span>
                <Input
                  type="number"
                  step={1}
                  value={value[key] ?? ''}
                  onChange={(event) => {
                    const next = { ...value }
                    if (event.target.value) next[key] = Number(event.target.value)
                    else delete next[key]
                    onChange(next)
                  }}
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
