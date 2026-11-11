import { useI18n } from '../../i18n'
import { useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Card } from '../../components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { ErrorAlert } from '../../components/error-alert'
import { useConfirm } from '../../components/confirm-dialog'
import { SchemaFields } from './SchemaFields'
import { SupportLabel, SupportNotice, supportLabel } from './SupportInfo'
import { driverKey, serviceDriver, type Service, type ObjectValue } from './model.mjs'
import type { InferenceManagement, InferenceSource } from './useInferenceManagement'

/** Services are saved independently of accounts and model discovery through the existing plan API. */
export function Services({ management: m }: { management: InferenceManagement }) {
  const i18n = useI18n()
  const view = m.view!
  const [editing, setEditing] = useState<{ service?: Service; source: InferenceSource } | null>(
    null
  )
  const { confirm, ConfirmDialog: dialog } = useConfirm()
  async function remove(service: Service) {
    const source = m.source!
    if (
      await confirm({
        title: i18n.t("删除 {0}？", [service.label ?? service.id]),
        description: i18n.t("仍被账号引用的服务需要先处理关联账号。"),
        variant: 'destructive'
      })
    )
      await m.savePlan({ version: 1, remove: { services: [service.id] } }, { source })
  }
  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{i18n.t("服务")}</h3>
        <Button disabled={m.busy || !!m.pending} onClick={() => setEditing({ source: m.source! })}>
          <Plus />
          {i18n.t("添加服务")}
        </Button>
      </div>
      {!Object.keys(view.services).length ? (
        <Card className="p-8 text-center text-muted-foreground">{i18n.t("添加一个模型服务。")}</Card>
      ) : (
        <div className="divide-y rounded-lg border">
          {Object.values(view.services).map((service) => (
            <div key={service.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium">
                  <SupportLabel
                    label={service.label ?? service.id}
                    support={serviceDriver(view, service.id)?.support}
                  />
                </p>
                <p className="text-sm text-muted-foreground break-all">
                  {serviceDriver(view, service.id)?.label ?? service.driver.id}
                </p>
              </div>
              {service.ownerId === view.ownerId ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("编辑服务 {0}", [service.label ?? service.id])}
                    disabled={m.busy || !!m.pending}
                    onClick={() => setEditing({ service, source: m.source! })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("删除服务 {0}", [service.label ?? service.id])}
                    disabled={m.busy || !!m.pending}
                    onClick={() => void remove(service)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.service ? i18n.t("编辑服务") : i18n.t("添加服务")}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ServiceForm
              key={editing.service?.id ?? 'new'}
              {...editing}
              management={m}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ServiceForm({
  service,
  source,
  management: m,
  onSaved
}: {
  service?: Service
  source: InferenceSource
  management: InferenceManagement
  onSaved: () => void
}) {
  const i18n = useI18n()
  const [driverId, setDriverId] = useState(service ? driverKey(service.driver) : '')
  const [label, setLabel] = useState(service?.label ?? '')
  const [options, setOptions] = useState<ObjectValue>(service?.options ?? {})
  const [valid, setValid] = useState(true)
  const [error, setError] = useState('')
  const driver = source.view.drivers.find((value) => driverKey(value) === driverId)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!driver) {
      setError(i18n.t("请选择服务类型。"))
      return
    }
    if (!valid) {
      setError(i18n.t("请检查连接参数。"))
      return
    }
    setError('')
    const id = service?.id ?? `service-${crypto.randomUUID()}`
    if (
      await m.savePlan(
        {
          version: 1,
          services: {
            [id]: {
              driver: {
                id: driver.id,
                owner: driver.owner,
                contractVersion: driver.contractVersion
              },
              options,
              models: service?.models ?? {},
              label: label || driver.label
            }
          }
        },
        { source }
      )
    )
      onSaved()
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={m.busy || !!m.pending} className="space-y-4">
        {error ? <ErrorAlert error={error} /> : null}
        {m.error ? <ErrorAlert error={m.error} /> : null}
        {driver ? <SupportNotice support={driver.support} /> : null}
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("名称")}</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={i18n.t("如：我的模型服务")}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span>{i18n.t("服务类型")}</span>
          <SelectField
            value={driverId}
            disabled={!!service}
            onValueChange={(id) => {
              setDriverId(id)
              setOptions({})
              setValid(true)
            }}
            options={[
              { value: '', label: i18n.t("选择服务类型") },
              ...source.view.drivers.map((value) => ({
                value: driverKey(value),
                label: supportLabel(value.label, value.support)
              }))
            ]}
          />
        </label>
        {driver ? (
          <SchemaFields
            key={driverId}
            schema={driver.serviceSchema}
            value={options}
            onChange={setOptions}
            onValidityChange={setValid}
          />
        ) : null}
        <Button type="submit">{i18n.t("保存")}</Button>
      </fieldset>
    </form>
  )
}
