import { useI18n } from '../../i18n'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Checkbox } from '../../components/ui/checkbox'
import type { Driver, Kind, ModelDefinition } from './model.mjs'

interface ModelCapabilitiesProps {
  readonly driver: Driver
  readonly value: ModelDefinition
  readonly onChange: (value: ModelDefinition) => void
}
type Translate = ReturnType<typeof useI18n>['t']
const kindLabels = (t: Translate): Record<Kind, string> => ({
  language: t('语言模型'),
  decision: t('决策模型'),
  image: t('图像生成'),
})
const inputLabels = (t: Translate): Record<string, string> => ({
  text: t('文字'),
  image: t('图片'),
  audio: t('音频'),
  video: t('视频'),
  file: t('文件'),
})
const booleanFieldLabels = (t: Translate) => ({ streaming: t('流式输出'), toolCalling: t('工具调用'), thinking: t('思考') }) as const
type BooleanField = keyof ReturnType<typeof booleanFieldLabels>

/** These are explicit capability declarations, never guesses from a model's name or protocol. */
export function ModelCapabilities({ driver, value, onChange }: ModelCapabilitiesProps) {
  const i18n = useI18n()
  const contract = driver.modelContracts.find((item) => item.protocol === value.protocol)
  const kinds = kindLabels(i18n.t), inputs = inputLabels(i18n.t), booleanFields = booleanFieldLabels(i18n.t)
  function booleanValue(key: BooleanField, selected: string) {
    const next = { ...value }
    if (!selected) delete next[key]
    else next[key] = selected === 'true'
    onChange(next)
  }
  return (
    <section className="space-y-4 rounded-md border p-4">
      <h4 className="text-sm font-medium">{i18n.t("模型能力")}</h4>
      <label className="block space-y-2 text-sm">
        <span>{i18n.t("协议")}</span>
        <SelectField
          value={value.protocol}
          onValueChange={(protocol) => onChange({ id: value.id, protocol, kinds: [] })}
          options={[
            { value: '', label: i18n.t("选择协议") },
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
              const field = key as BooleanField
              return (
                <label key={key} className="space-y-2 text-sm">
                  <span>{label}</span>
                  <SelectField
                    value={value[field] === undefined ? '' : String(value[field])}
                    onValueChange={(selected) => booleanValue(field, selected)}
                    options={[
                      { value: '', label: i18n.t("未声明") },
                      { value: 'true', label: i18n.t("支持") },
                      { value: 'false', label: i18n.t("不支持") },
                    ]}
                  />
                </label>
              )
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['contextWindow', 'maxOutputTokens'] as const).map((key) => (
              <label key={key} className="space-y-2 text-sm">
                <span>{key === 'contextWindow' ? i18n.t("上下文容量（tokens）") : i18n.t("最大输出容量（tokens）")}</span>
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
