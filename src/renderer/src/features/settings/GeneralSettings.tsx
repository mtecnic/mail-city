import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, onEvent } from '@renderer/lib/api'
import type { ChannelOutput } from '@shared/ipc'
import { Field, Select, Input, Button } from '@renderer/components/ui'
import type { AppSettings } from '@shared/schemas/settings'
import { ExportBackupDialog, RestoreBackupDialog } from './BackupDialogs'

export function GeneralSettings() {
  const qc = useQueryClient()
  const s = useQuery({ queryKey: ['settings'], queryFn: () => invoke('settings.get') })
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => invoke('settings.set', patch),
    onSuccess: (next) => qc.setQueryData(['settings'], next)
  })
  const [exporting, setExporting] = useState(false)
  const [restoring, setRestoring] = useState(false)
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
        <NumberField label="Initial sync window (days)" hint="How far back to download headers when an account is added." min={7} max={3650} value={v.sync.initialWindowDays} onCommit={(n) => save.mutate({ sync: { initialWindowDays: n } })} />
        <NumberField label="Poll interval for non-inbox folders (minutes)" min={1} max={60} value={v.sync.pollIntervalMinutes} onCommit={(n) => save.mutate({ sync: { pollIntervalMinutes: n } })} />
        <NumberField label="Undo send window (seconds)" min={0} max={60} value={v.compose.undoSendSeconds} onCommit={(n) => save.mutate({ compose: { undoSendSeconds: n } })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.minimizeToTray} onChange={(e) => save.mutate({ minimizeToTray: e.target.checked })} /> Keep running in the tray when the window is closed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.launchAtLogin} onChange={(e) => save.mutate({ launchAtLogin: e.target.checked })} /> Launch at login
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.notifications.enabled} onChange={(e) => save.mutate({ notifications: { enabled: e.target.checked } })} /> Show notifications for new mail
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.notifications.sound} onChange={(e) => save.mutate({ notifications: { sound: e.target.checked } })} /> Play a sound
        </label>
        <div>
          <Button size="sm" variant="ghost" onClick={() => invoke('app.showNotificationTest')}>
            Send a test notification
          </Button>
        </div>
        <Field label="Remote images in messages">
          <Select value={v.privacy.loadRemoteImages} onChange={(e) => save.mutate({ privacy: { loadRemoteImages: e.target.value } })}>
            <option value="never">Block (click to load)</option>
            <option value="always">Always load</option>
          </Select>
        </Field>
      </div>

      <h3 className="pt-4 text-sm font-semibold">Backup & restore</h3>
      <p className="max-w-md text-xs text-muted">Move your whole setup to another computer: accounts with their passwords and tokens, identities, rules, contacts, settings and AI keys, in one passphrase-encrypted file. Mail is not included and syncs again after a restore.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setExporting(true)}>
          Export a backup…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRestoring(true)}>
          Restore from a backup…
        </Button>
      </div>
      <ExportBackupDialog open={exporting} onClose={() => setExporting(false)} />
      <RestoreBackupDialog open={restoring} onClose={() => setRestoring(false)} />

      <h3 className="pt-4 text-sm font-semibold">Updates & diagnostics</h3>
      <div className="flex gap-2">
        <UpdateCheck />
        <Button size="sm" variant="ghost" onClick={() => invoke('app.openLogs')}>
          Open log folder
        </Button>
      </div>
    </div>
  )
}

/** A number setting that commits on blur or Enter, and explains an out-of-range value instead of snapping back. */
function NumberField({ label, hint, min, max, value, onCommit }: { label: string; hint?: string; min: number; max: number; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
      setError(`Enter a whole number from ${min} to ${max}.`)
      return
    }
    setError(null)
    if (n !== value) onCommit(n)
  }
  return (
    <Field label={label} hint={error ? <span className="text-danger">{error}</span> : hint}>
      <Input type="number" min={min} max={max} value={text} aria-invalid={!!error} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </Field>
  )
}

type UpdateStatus = ChannelOutput<'update.status'>

/** "Check for updates" that says what happened. */
function UpdateCheck() {
  const ver = useQuery({ queryKey: ['app.version'], queryFn: () => invoke('app.version') })
  const initial = useQuery({ queryKey: ['update.status'], queryFn: () => invoke('update.status') })
  const [live, setLive] = useState<UpdateStatus | null>(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => onEvent('update.status', setLive), [])
  const st = live ?? initial.data ?? { state: 'idle' as const }
  const packaged = ver.data?.packaged ?? false
  const message = !packaged
    ? 'This copy runs from source; the installed app updates itself.'
    : st.state === 'checking'
      ? 'Checking…'
      : st.state === 'available'
        ? `Version ${st.version} found, downloading…`
        : st.state === 'downloading'
          ? `Downloading update… ${st.percent}%`
          : st.state === 'downloaded'
            ? `Version ${st.version} is ready. It installs when you restart.`
            : st.state === 'error'
              ? `Couldn’t check for updates: ${st.message}`
              : checked
                ? 'You’re up to date.'
                : ''
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        loading={busy || st.state === 'checking'}
        disabled={!packaged}
        onClick={async () => {
          setBusy(true)
          try {
            await invoke('update.check')
          } finally {
            setBusy(false)
            setChecked(true)
          }
        }}
      >
        Check for updates
      </Button>
      {st.state === 'downloaded' && (
        <Button size="sm" variant="primary" onClick={() => invoke('update.install')}>
          Restart & update
        </Button>
      )}
      <span className="text-xs text-muted">
        {ver.data ? `Mail City ${ver.data.version}` : ''}
        {message ? ` · ${message}` : ''}
      </span>
    </span>
  )
}
