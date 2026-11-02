/**
 * Promise-based prompt/confirm dialogs (replacing window.prompt/confirm, which
 * Electron renders as bare OS boxes). Render `<DialogHost />` once at the root.
 */
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button, Dialog, Input, Field } from './ui'

type PromptReq = { kind: 'prompt'; title: string; label?: string; defaultValue?: string; placeholder?: string; okLabel?: string; validate?: (v: string) => string | null; resolve: (v: string | null) => void }
type ConfirmReq = { kind: 'confirm'; title: string; message?: string; okLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
type ColorReq = { kind: 'color'; title: string; current: string; resolve: (v: string | null) => void }

interface DialogState {
  queue: (PromptReq | ConfirmReq | ColorReq)[]
  push(r: PromptReq | ConfirmReq | ColorReq): void
  shift(): void
}

const useDialogs = create<DialogState>((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) }))
}))

export function promptDialog(opts: Omit<PromptReq, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'prompt', ...opts, resolve }))
}
export function confirmDialog(opts: Omit<ConfirmReq, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'confirm', ...opts, resolve }))
}
export function colorDialog(title: string, current: string): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'color', title, current, resolve }))
}

export const PALETTE = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#64748b', '#0f766e', '#be123c', '#4338ca']

export function DialogHost() {
  const { queue, shift } = useDialogs()
  const req = queue[0]
  if (!req) return null
  const done = () => shift()
  if (req.kind === 'prompt') return <PromptView key={queue.length} req={req} done={done} />
  if (req.kind === 'color') {
    return (
      <Dialog open onClose={() => { req.resolve(null); done() }} title={req.title} width="max-w-xs">
        <div className="grid grid-cols-6 gap-2">
          {PALETTE.map((c) => (
            <button key={c} className="size-8 rounded-full border-2" style={{ background: c, borderColor: c === req.current ? 'var(--color-fg)' : 'transparent' }} onClick={() => { req.resolve(c); done() }} aria-label={c} />
          ))}
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog open onClose={() => { req.resolve(false); done() }} title={req.title} width="max-w-sm">
      {req.message && <p className="mb-4 text-sm text-muted">{req.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { req.resolve(false); done() }}>
          Cancel
        </Button>
        <Button variant={req.danger ? 'danger' : 'primary'} autoFocus onClick={() => { req.resolve(true); done() }}>
          {req.okLabel ?? 'OK'}
        </Button>
      </div>
    </Dialog>
  )
}

function PromptView({ req, done }: { req: PromptReq; done: () => void }) {
  const [value, setValue] = useState(req.defaultValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const submit = () => {
    const err = req.validate?.(value) ?? null
    if (err) return setError(err)
    req.resolve(value)
    done()
  }
  return (
    <Dialog open onClose={() => { req.resolve(null); done() }} title={req.title} width="max-w-sm">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={req.label ?? ''}>
          <Input ref={ref} value={value} placeholder={req.placeholder} onChange={(e) => { setValue(e.target.value); setError(null) }} />
        </Field>
        {error && <div className="text-xs text-danger">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { req.resolve(null); done() }}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {req.okLabel ?? 'OK'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
