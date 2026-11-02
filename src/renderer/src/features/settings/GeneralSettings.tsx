import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/api'
import { Field, Select, Input } from '@renderer/components/ui'
import type { AppSettings } from '@shared/schemas/settings'

export function GeneralSettings() {
  const qc = useQueryClient()
  const s = useQuery({ queryKey: ['settings'], queryFn: () => invoke('settings.get') })
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => invoke('settings.set', patch),
    onSuccess: (next) => qc.setQueryData(['settings'], next)
  })
  if (!s.data) return null
  const v = s.data

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">General</h3>
      <div className="grid max-w-md gap-4">
        <Field label="Theme">
          <Select value={v.theme} onChange={(e) => save.mutate({ theme: e.target.value as AppSettings['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>
        <Field label="Density">
          <Select value={v.density} onChange={(e) => save.mutate({ density: e.target.value })}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </Select>
        </Field>
        <Field label="Initial sync window (days)" hint="How far back to download headers when an account is added.">
          <Input type="number" min={7} max={3650} value={v.sync.initialWindowDays} onChange={(e) => save.mutate({ sync: { initialWindowDays: Number(e.target.value) } })} />
        </Field>
        <Field label="Poll interval for non-inbox folders (minutes)">
          <Input type="number" min={1} max={60} value={v.sync.pollIntervalMinutes} onChange={(e) => save.mutate({ sync: { pollIntervalMinutes: Number(e.target.value) } })} />
        </Field>
        <Field label="Undo send window (seconds)">
          <Input type="number" min={0} max={60} value={v.compose.undoSendSeconds} onChange={(e) => save.mutate({ compose: { undoSendSeconds: Number(e.target.value) } })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.minimizeToTray} onChange={(e) => save.mutate({ minimizeToTray: e.target.checked })} /> Keep running in the tray when the window is closed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.launchAtLogin} onChange={(e) => save.mutate({ launchAtLogin: e.target.checked })} /> Launch at login
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.notifications.enabled} onChange={(e) => save.mutate({ notifications: { enabled: e.target.checked } })} /> Show notifications for new mail
        </label>
      </div>
    </div>
  )
}
