import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Alert, Button, Dialog, Field, Input, Select, Spinner } from '@renderer/components/ui'
import type { ChannelInput, ChannelOutput } from '@shared/ipc'
import type { ServerConfig } from '@shared/schemas/account'

type Discovery = ChannelOutput<'accounts.discover'>
type CreateReq = ChannelInput<'accounts.create'>
type Step = 'email' | 'discovering' | 'auth' | 'testing' | 'done'

const DEFAULT_IMAP: ServerConfig = { host: '', port: 993, tls: 'tls' }
const DEFAULT_SMTP: ServerConfig = { host: '', port: 587, tls: 'starttls' }

export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [disc, setDisc] = useState<Discovery | null>(null)
  const [imap, setImap] = useState<ServerConfig>(DEFAULT_IMAP)
  const [smtp, setSmtp] = useState<ServerConfig>(DEFAULT_SMTP)
  const [password, setPassword] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<ChannelOutput<'accounts.test'> | null>(null)

  const oauthCfg = useQuery({ queryKey: ['oauth.config'], queryFn: () => invoke('oauth.config.get'), enabled: open })

  const reset = () => {
    setStep('email')
    setEmail('')
    setDisplayName('')
    setDisc(null)
    setImap(DEFAULT_IMAP)
    setSmtp(DEFAULT_SMTP)
    setPassword('')
    setTicket(null)
    setAdvanced(false)
    setError(null)
    setTest(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const discover = useMutation({
    mutationFn: () => invoke('accounts.discover', { email }),
    onMutate: () => {
      setError(null)
      setStep('discovering')
    },
    onSuccess: (d) => {
      setDisc(d)
      if (d.imap) setImap(d.imap)
      if (d.smtp) setSmtp(d.smtp)
      setAdvanced(d.source === 'none')
      setStep('auth')
    },
    onError: (e) => {
      setError(e.message)
      setStep('email')
    }
  })

  const oauth = useMutation({
    mutationFn: () => invoke('oauth.start', { provider: disc!.oauthProvider!, loginHint: email }),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setTicket(r.ticket)
      if (r.email && r.email !== email) setEmail(r.email)
      if (!displayName) setDisplayName(r.displayName)
    },
    onError: (e) => setError(e.message)
  })

  const buildReq = (): CreateReq => ({
    type: disc?.type ?? 'imap',
    email,
    displayName: displayName || email,
    imap,
    smtp,
    auth: ticket ? { type: 'oauth2', ticket } : { type: 'password', password }
  })

  const runTest = useMutation({
    mutationFn: () => invoke('accounts.test', buildReq()),
    onMutate: () => {
      setError(null)
      setTest(null)
      setStep('testing')
    },
    onSuccess: (r) => {
      setTest(r)
      setStep('auth')
    },
    onError: (e) => {
      setError(e.message)
      setStep('auth')
    }
  })

  const create = useMutation({
    mutationFn: () => invoke('accounts.create', buildReq()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts.list'] })
      setStep('done')
      setTimeout(close, 800)
    },
    onError: (e) => setError(e.message)
  })

  const usesOAuth = !!disc?.oauthProvider && (disc.oauthProvider === 'google' ? oauthCfg.data?.hasGoogle : oauthCfg.data?.hasMicrosoft)
  const canSubmit = !!email && !!imap.host && !!smtp.host && (ticket ? true : password.length > 0)

  return (
    <Dialog open={open} onClose={close} title="Add account" width="max-w-xl">
      {error && (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {(step === 'email' || step === 'discovering') && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            discover.mutate()
          }}
        >
          <Field label="Email address">
            <Input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={step === 'discovering'} />
          </Field>
          <Field label="Display name (optional)">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Work, Personal, …" />
          </Field>
          <div className="flex items-center justify-end gap-2">
            {step === 'discovering' && (
              <span className="mr-auto flex items-center gap-2 text-xs text-muted">
                <Spinner /> Looking up mail servers…
              </span>
            )}
            <Button variant="ghost" type="button" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!email.includes('@')} loading={step === 'discovering'}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {(step === 'auth' || step === 'testing') && disc && (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs">
            <div className="font-medium">{disc.providerLabel}</div>
            <div className="text-muted">
              {disc.source === 'none' ? 'Could not detect server settings — enter them below.' : `Settings found via ${sourceLabel(disc.source)}.`}
            </div>
          </div>

          {usesOAuth ? (
            <div className="space-y-2">
              {ticket ? (
                <Alert kind="success">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="size-4" /> Signed in as {email}
                  </span>
                </Alert>
              ) : (
                <Button variant="primary" onClick={() => oauth.mutate()} loading={oauth.isPending} className="w-full">
                  Sign in with {disc.oauthProvider === 'google' ? 'Google' : 'Microsoft'}
                </Button>
              )}
              <p className="text-xs text-muted">A browser window will open. Mail City only receives a token for IMAP/SMTP access; your password never touches this app.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {disc.oauthProvider && (
                <Alert kind="warn">
                  OAuth sign-in for {disc.oauthProvider === 'google' ? 'Google' : 'Microsoft'} is not configured (Settings → Accounts → OAuth clients). You can use an app password instead.
                </Alert>
              )}
              <Field label="Password / app password" hint={disc.passwordHint}>
                <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {disc.helpUrl && (
                <button className="text-xs text-accent hover:underline" onClick={() => invoke('app.openExternal', { url: disc.helpUrl! })}>
                  How do I create an app password?
                </button>
              )}
            </div>
          )}

          <button className="text-xs text-muted hover:text-fg" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Server settings
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-3">
              <ServerFields label="Incoming (IMAP)" value={imap} onChange={setImap} />
              <ServerFields label="Outgoing (SMTP)" value={smtp} onChange={setSmtp} />
            </div>
          )}

          {test && (
            <div className="space-y-1 text-xs">
              <TestLine label="IMAP" r={test.imap} />
              <TestLine label="SMTP" r={test.smtp} />
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('email')}>
              Back
            </Button>
            <Button onClick={() => runTest.mutate()} disabled={!canSubmit} loading={step === 'testing'}>
              Test
            </Button>
            <Button variant="primary" onClick={() => create.mutate()} disabled={!canSubmit} loading={create.isPending}>
              Add account
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex items-center gap-2 py-6 text-sm">
          <CheckCircle2 className="size-5 text-green-500" /> Account added. Starting first sync…
        </div>
      )}
    </Dialog>
  )
}

function TestLine({ label, r }: { label: string; r: { ok: boolean; error?: string } }) {
  return (
    <div className="flex items-center gap-2">
      {r.ok ? <CheckCircle2 className="size-4 text-green-500" /> : <XCircle className="size-4 text-danger" />}
      <span className="font-medium">{label}</span>
      <span className="text-muted">{r.ok ? 'OK' : r.error}</span>
    </div>
  )
}

function ServerFields({ label, value, onChange }: { label: string; value: ServerConfig; onChange: (v: ServerConfig) => void }) {
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

function sourceLabel(s: Discovery['source']): string {
  return { known: 'provider presets', mx: 'your domain’s MX records', ispdb: 'the Mozilla ISP database', autoconfig: 'your provider’s autoconfig', srv: 'DNS SRV records', guess: 'common host names', none: '' }[s]
}
