/**
 * Tiny UI kit: just enough primitives, styled with Tailwind tokens from globals.css.
 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
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

export function Dialog({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full rounded-lg border border-border bg-panel shadow-xl', width)} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="rounded p-1 hover:bg-hover" onClick={onClose} aria-label="Close">
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
