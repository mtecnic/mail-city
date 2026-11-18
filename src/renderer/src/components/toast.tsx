/**
 * One stack of small notifications at the bottom left: action feedback with Undo,
 * send confirmations and errors. `toast()` can be called from anywhere.
 */
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from './ui'

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: string
  kind: ToastKind
  text: string
  action?: { label: string; run: () => void }
  /** Milliseconds before it disappears; 0 keeps it until dismissed or replaced. */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push(t: Omit<Toast, 'id' | 'duration' | 'kind'> & Partial<Pick<Toast, 'id' | 'duration' | 'kind'>>): string
  dismiss(id: string): void
}

let seq = 0
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? `t${++seq}`
    const full: Toast = { kind: 'info', duration: t.action ? 7000 : 4000, ...t, id }
    // Same id replaces in place (used for live countdowns); otherwise newest last, at most 4.
    set((s) => ({ toasts: s.toasts.some((x) => x.id === id) ? s.toasts.map((x) => (x.id === id ? full : x)) : [...s.toasts, full].slice(-4) }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}))

export const toast = (t: Parameters<ToastState['push']>[0]) => useToasts.getState().push(t)
export const dismissToast = (id: string) => useToasts.getState().dismiss(id)

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[90] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" role="status">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  )
}

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const arm = () => {
    if (timer.current) clearTimeout(timer.current)
    if (t.duration > 0) timer.current = setTimeout(() => dismiss(t.id), t.duration)
  }
  useEffect(() => {
    arm()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [t])
  const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info
  return (
    <div
      className={cn('pointer-events-auto flex items-center gap-3 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg animate-in', t.kind === 'error' ? 'border-danger/50' : 'border-border')}
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
      onMouseLeave={arm}
    >
      <Icon className={cn('size-4 shrink-0', t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-green-600' : 'text-accent')} />
      <span className="min-w-0 flex-1 break-words">{t.text}</span>
      {t.action && (
        <button
          className="shrink-0 rounded px-2 py-0.5 text-sm font-medium text-accent hover:bg-hover"
          onClick={() => {
            t.action!.run()
            dismiss(t.id)
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}
