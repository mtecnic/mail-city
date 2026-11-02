import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Alert, Button, Dialog, Field, Input, Select, cn } from '@renderer/components/ui'
import { PALETTE } from '@renderer/components/dialogs'
import type { ChannelOutput } from '@shared/ipc'
import type { ServerConfig } from '@shared/schemas/account'

type Detail = ChannelOutput<'accounts.get'>
export type EditTab = 'general' | 'servers' | 'signin'

export function EditAccountDialog({ accountId, initialTab = 'general', onClose }: { accountId: string | null; initialTab?: EditTab; onClose: () => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<EditTab>(initialTab)
  const detail = useQuery({ queryKey: ['accounts.get', accountId], queryFn: () => invoke('accounts.get', { id: accountId! }), enabled: !!accountId })
  useEffect(() => setTab(initialTab), [initialTab, accountId])
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['accounts.list'] })
    void qc.invalidateQueries({ queryKey: ['accounts.get', accountId] })
  }
  if (!accountId) return null
  const d = detail.data
  return (
    <Dialog open onClose={onClose} title={d ? `${d.displayName} — ${d.email}` : 'Account'} width="max-w-2xl">
      {!d ? null : (
        <div className="flex min-h-80 gap-4">
          <nav className="w-36 shrink-0 space-y-0.5 border-r border-border pr-3">
            {(
              [
                ['general', 'General'],
                ['servers', 'Servers'],
                ['signin', 'Sign-in']
              ] as [EditTab, string][]
            ).map(([id, label]) => (
              <button key={id} className={cn('block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-hover', tab === id && 'bg-hover font-medium')} onClick={() => setTab(id)}>
                {label}
                {id === 'signin' && d.lastError && <span className="ml-1 inline-block size-2 rounded-full bg-danger" />}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {d.lastError && tab !== 'signin' && (
              <div className="mb-3">
                <Alert kind="error">
                  {d.lastError}{' '}
                  <button className="underline" onClick={() => setTab('signin')}>
                    Fix sign-in
                  </button>
                </Alert>
              </div>
            )}
            {tab === 'general' && <GeneralTab d={d} onSaved={refresh} />}
            {tab === 'servers' && <ServersTab d={d} onSaved={refresh} />}
            {tab === 'signin' && <SignInTab d={d} onSaved={refresh} />}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function GeneralTab({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [name, setName] = useState(d.displayName)
  const [color, setColor] = useState(d.color)
  const [enabled, setEnabled] = useState(d.enabled)
  const [days, setDays] = useState(d.syncSettings.initialWindowDays ?? 90)
  const save = useMutation({ mutationFn: () => invoke('accounts.update', { id: d.id, patch: { displayName: name, color, enabled, syncSettings: { initialWindowDays: days } } }), onSuccess: onSaved })
  return (
    <div className="space-y-4">
      <Field label="Display name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Color">
        <div className="flex flex-wrap gap-2 pt-1">
          {PALETTE.map((c) => (
            <button key={c} className="size-7 rounded-full border-2" style={{ background: c, borderColor: c === color ? 'var(--color-fg)' : 'transparent' }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      </Field>
      <Field label="Initial sync window (days)" hint="How far back headers are downloaded for new folders.">
        <Input type="number" min={7} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Sync this account
      </label>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
          Save
        </Button>
      </div>
      {save.error && <Alert kind="error">{save.error.message}</Alert>}
    </div>
  )
}

function ServersTab({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [imap, setImap] = useState<ServerConfig>(d.imap)
  const [smtp, setSmtp] = useState<ServerConfig>(d.smtp)
  const [test, setTest] = useState<ChannelOutput<'accounts.testExisting'> | null>(null)
  const save = useMutation({ mutationFn: () => invoke('accounts.update', { id: d.id, patch: { imap, smtp } }), onSuccess: onSaved })
  const runTest = useMutation({ mutationFn: async () => { await save.mutateAsync(); return invoke('accounts.testExisting', { id: d.id }) }, onSuccess: setTest })
  const rediscover = useMutation({
    mutationFn: () => invoke('accounts.discover', { email: d.email }),
    onSuccess: (r) => {
      if (r.imap) setImap(r.imap)
      if (r.smtp) setSmtp(r.smtp)
    }
  })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <ServerFields label="Incoming (IMAP)" value={imap} onChange={setImap} />
        <ServerFields label="Outgoing (SMTP)" value={smtp} onChange={setSmtp} />
      </div>
      {test && (
        <div className="space-y-1 text-xs">
          <TestLine label="IMAP" r={test.imap} />
          <TestLine label="SMTP" r={test.smtp} />
        </div>
      )}
      {(save.error || runTest.error) && <Alert kind="error">{(save.error ?? runTest.error)!.message}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => rediscover.mutate()} loading={rediscover.isPending}>
          Re-detect
        </Button>
        <Button onClick={() => runTest.mutate()} loading={runTest.isPending}>
          Save & test
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted">Saving server changes reconnects the account.</p>
    </div>
  )
}

function SignInTab({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [test, setTest] = useState<ChannelOutput<'accounts.testExisting'> | null>(null)
  const oauthCfg = useQuery({ queryKey: ['oauth.config'], queryFn: () => invoke('oauth.config.get') })
  const provider = d.oauthProvider ?? (d.type === 'gmail' ? 'google' : d.type === 'outlook' ? 'microsoft' : null)
  const oauthAvailable = provider === 'google' ? oauthCfg.data?.hasGoogle : provider === 'microsoft' ? oauthCfg.data?.hasMicrosoft : false
  const setPw = useMutation({
    mutationFn: async () => {
      await invoke('accounts.setPassword', { id: d.id, password })
      return invoke('accounts.testExisting', { id: d.id })
    },
    onSuccess: (r) => {
      setTest(r)
      setPassword('')
      onSaved()
    }
  })
  const reauth = useMutation({
    mutationFn: async () => {
      const t = await invoke('oauth.start', { provider: provider!, loginHint: d.email })
      await invoke('accounts.reauth', { id: d.id, ticket: t.ticket })
      return invoke('accounts.testExisting', { id: d.id })
    },
    onSuccess: (r) => {
      setTest(r)
      onSaved()
    }
  })
  const testOnly = useMutation({ mutationFn: () => invoke('accounts.testExisting', { id: d.id }), onSuccess: setTest })

  return (
    <div className="space-y-4">
      {d.lastError && <Alert kind="error">{d.lastError}</Alert>}
      <div className="text-xs text-muted">
        Currently signed in with {d.authType === 'oauth2' ? `OAuth (${d.oauthProvider})` : 'a password'}.
      </div>

      {provider && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-sm font-medium">{provider === 'google' ? 'Google' : 'Microsoft'} sign-in (recommended)</div>
          {oauthAvailable ? (
            <Button variant="primary" onClick={() => reauth.mutate()} loading={reauth.isPending}>
              {d.authType === 'oauth2' ? 'Sign in again' : `Switch to ${provider === 'google' ? 'Google' : 'Microsoft'} sign-in`}
            </Button>
          ) : (
            <p className="text-xs text-muted">Add a {provider === 'google' ? 'Google' : 'Microsoft'} OAuth client in Settings → Accounts → OAuth clients to enable this (see docs/OAUTH-SETUP.md).</p>
          )}
          {reauth.error && <Alert kind="error">{reauth.error.message}</Alert>}
        </div>
      )}

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="text-sm font-medium">{d.type === 'gmail' ? 'App password' : d.type === 'icloud' || d.type === 'yahoo' ? 'App-specific password' : 'Password'}</div>
        {d.type === 'gmail' && <p className="text-xs text-muted">Google rejects normal passwords over IMAP. Create an App Password at myaccount.google.com/apppasswords (needs 2-Step Verification) and paste it here.</p>}
        <div className="flex gap-2">
          <Input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && setPw.mutate()} />
          <Button onClick={() => setPw.mutate()} disabled={!password} loading={setPw.isPending}>
            Save & test
          </Button>
        </div>
        {setPw.error && <Alert kind="error">{setPw.error.message}</Alert>}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => testOnly.mutate()} loading={testOnly.isPending}>
          Test current credentials
        </Button>
        {test && (
          <div className="space-y-0.5 text-xs">
            <TestLine label="IMAP" r={test.imap} />
            <TestLine label="SMTP" r={test.smtp} />
          </div>
        )}
      </div>
    </div>
  )
}

export function ServerFields({ label, value, onChange }: { label: string; value: ServerConfig; onChange: (v: ServerConfig) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{label}</div>
      <Input placeholder="host" value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} />
      <div className="flex gap-2">
        <Input type="number" className="w-24" value={value.port} onChange={(e) => onChange({ ...value, port: Number(e.target.value) })} />
        <Select value={value.tls} onChange={(e) => onChange({ ...value, tls: e.target.value as ServerConfig['tls'] })}>
          <option value="tls">SSL/TLS</option>
          <option value="starttls">STARTTLS</option>
          <option value="none">None</option>
        </Select>
      </div>
    </div>
  )
}

export function TestLine({ label, r }: { label: string; r: { ok: boolean; error?: string } }) {
  return (
    <div className="flex items-center gap-2">
      {r.ok ? <CheckCircle2 className="size-4 text-green-500" /> : <XCircle className="size-4 text-danger" />}
      <span className="font-medium">{label}</span>
      <span className="text-muted">{r.ok ? 'OK' : r.error}</span>
    </div>
  )
}
