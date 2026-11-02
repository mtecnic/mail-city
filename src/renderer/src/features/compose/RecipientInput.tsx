import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/components/ui'
import type { Address } from '@shared/schemas/mail'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

function parse(text: string): Address[] {
  const out: Address[] = []
  for (const part of text.split(/[,;\n]+/)) {
    const s = part.trim()
    if (!s) continue
    const m = s.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/)
    if (m && m[2]) out.push({ name: (m[1] ?? '').trim(), address: m[2].trim().toLowerCase() })
    else if (EMAIL.test(s)) out.push({ name: '', address: s.toLowerCase() })
  }
  return out
}

export function RecipientInput({ label, value, onChange, autoFocus }: { label: string; value: Address[]; onChange: (v: Address[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  const commit = () => {
    if (!text.trim()) return true
    const parsed = parse(text)
    if (!parsed.length) {
      setInvalid(true)
      return false
    }
    onChange([...value, ...parsed.filter((p) => !value.some((v) => v.address === p.address))])
    setText('')
    setInvalid(false)
    return true
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (text.trim()) {
        e.preventDefault()
        commit()
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="flex min-h-8 items-start gap-2 border-b border-border py-1 text-sm">
      <span className="w-10 shrink-0 pt-0.5 text-xs text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {value.map((a) => (
          <span key={a.address} className="flex items-center gap-1 rounded-full border border-border bg-panel px-2 py-0.5 text-xs" title={a.address}>
            {a.name || a.address}
            <button className="text-muted hover:text-fg" onClick={() => onChange(value.filter((v) => v.address !== a.address))} aria-label="Remove">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          className={cn('min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none', invalid && 'text-danger')}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value)
            setInvalid(false)
          }}
          onKeyDown={onKey}
          onBlur={commit}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text')
            if (/[,;\n]/.test(t)) {
              e.preventDefault()
              const parsed = parse(t)
              if (parsed.length) onChange([...value, ...parsed])
            }
          }}
        />
      </div>
    </div>
  )
}
