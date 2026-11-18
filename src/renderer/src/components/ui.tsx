/**
 * Tiny UI kit: just enough primitives, styled with Tailwind tokens from globals.css.
 */
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Loader2, X } from 'lucide-react'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = 'secondary', size = 'md', loading, children, disabled, ...rest }, ref) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-accent text-accent-fg hover:brightness-110',
    secondary: 'border border-border bg-panel hover:bg-hover',
    ghost: 'hover:bg-hover',
    danger: 'bg-danger text-white hover:brightness-110'
  }
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' }
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn('h-9 w-full rounded-md border border-border bg-bg px-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none', className)}
      {...rest}
    />
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn('h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus:border-accent focus:outline-none', className)} {...rest} />
})

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

/** Open dialogs, newest last: only the topmost one reacts to Escape. */
const openDialogs: string[] = []
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * Modal dialog: Escape closes the topmost one, focus moves inside, Tab stays inside, and focus
 * returns to where it was on close. `dismissable={false}` ignores backdrop clicks for dialogs
 * that hold work in progress (account wizard, restore).
 */
export function Dialog({ open, onClose, title, children, width = 'max-w-lg', dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string; dismissable?: boolean }) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    openDialogs.push(id)
    // Focus the first field (or the panel) once the content has rendered.
    const t = setTimeout(() => {
      const el = panel.current
      if (!el || el.contains(document.activeElement)) return
      const first = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => !n.closest('[data-dialog-close]'))
      ;(first ?? el).focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (document.querySelector('[data-ctx-menu]')) return // let an open menu close first
        e.preventDefault()
        close.current()
      } else if (e.key === 'Tab' && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
        if (!nodes.length) return
        const first = nodes[0]!
        const last = nodes[nodes.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      const i = openDialogs.lastIndexOf(id)
      if (i >= 0) openDialogs.splice(i, 1)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [open, id])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div ref={panel} tabIndex={-1} className={cn('w-full rounded-lg border border-border bg-panel shadow-xl outline-none animate-pop', width)} role="dialog" aria-modal aria-labelledby={`${id}-title`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {title}
          </h2>
          <button className="rounded p-1 hover:bg-hover" onClick={onClose} aria-label="Close" data-dialog-close>
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  const styles = {
    info: 'border-accent/40 bg-accent/10',
    error: 'border-danger/40 bg-danger/10',
    success: 'border-green-600/40 bg-green-600/10',
    warn: 'border-yellow-600/40 bg-yellow-600/10'
  }
  return <div className={cn('rounded-md border px-3 py-2 text-xs', styles[kind])}>{children}</div>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />
}
