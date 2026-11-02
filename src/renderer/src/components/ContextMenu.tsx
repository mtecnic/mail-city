/**
 * Right-click / dropdown menus. `useContextMenu()` gives you `open(event, items)`;
 * render `<ContextMenuHost />` once at the app root.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { create } from 'zustand'
import { cn } from './ui'

export type MenuItem =
  | { type?: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean; submenu?: MenuItem[] | (() => MenuItem[]); onSelect?: () => void }
  | { type: 'separator' }
  | { type: 'label'; label: string }

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  show(x: number, y: number, items: MenuItem[]): void
  hide(): void
}

const useMenuStore = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false, items: [] })
}))

export function useContextMenu() {
  const show = useMenuStore((s) => s.show)
  const hide = useMenuStore((s) => s.hide)
  return {
    /** Attach to onContextMenu or a button click. */
    open(e: ReactMouseEvent | MouseEvent | { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
      e.preventDefault?.()
      e.stopPropagation?.()
      if (!items.length) return
      show(e.clientX, e.clientY, items)
    },
    /** Open anchored below an element (for toolbar dropdowns). */
    openAt(el: HTMLElement, items: MenuItem[]) {
      const r = el.getBoundingClientRect()
      show(r.left, r.bottom + 2, items)
    },
    close: hide
  }
}

export function ContextMenuHost() {
  const { open, x, y, items, hide } = useMenuStore()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-ctx-menu]')) hide()
    }
    const onScroll = () => hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('blur', onScroll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('blur', onScroll)
    }
  }, [open, hide])
  if (!open) return null
  return createPortal(<MenuPanel x={x} y={y} items={items} onClose={hide} root />, document.body)
}

function MenuPanel({ x, y, items, onClose, root }: { x: number; y: number; items: MenuItem[]; onClose: () => void; root?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number; items: MenuItem[] } | null>(null)
  const [hi, setHi] = useState(-1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - r.width - 8)
    const top = Math.min(y, window.innerHeight - r.height - 8)
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [x, y, items])

  useEffect(() => {
    if (!root) return
    const onKey = (e: KeyboardEvent) => {
      const selectable = items.map((it, i) => ({ it, i })).filter(({ it }) => (!it.type || it.type === 'item') && !(it as { disabled?: boolean }).disabled)
      if (!selectable.length) return
      const cur = selectable.findIndex(({ i }) => i === hi)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHi(selectable[(cur + 1) % selectable.length]!.i)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHi(selectable[(cur - 1 + selectable.length) % selectable.length]!.i)
      } else if (e.key === 'Enter' && hi >= 0) {
        e.preventDefault()
        const it = items[hi] as Extract<MenuItem, { type?: 'item' }>
        if (it.submenu) openSub(hi, it)
        else {
          it.onSelect?.()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openSub = (index: number, it: Extract<MenuItem, { type?: 'item' }>) => {
    const row = ref.current?.children[index] as HTMLElement | undefined
    if (!row || !it.submenu) return
    const r = row.getBoundingClientRect()
    const list = typeof it.submenu === 'function' ? it.submenu() : it.submenu
    setSub({ index, x: r.right - 2, y: r.top - 4, items: list })
  }

  return (
    <>
      <div ref={ref} data-ctx-menu className="fixed z-[100] min-w-44 max-w-80 rounded-md border border-border bg-panel py-1 text-sm shadow-xl" style={pos} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) => {
          if (it.type === 'separator') return <div key={i} className="my-1 h-px bg-border" />
          if (it.type === 'label') return <div key={i} className="px-3 py-1 text-[11px] font-semibold uppercase text-muted">{it.label}</div>
          const isSub = !!it.submenu
          return (
            <div
              key={i}
              className={cn('mx-1 flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5', it.disabled ? 'opacity-40' : 'hover:bg-hover', hi === i && 'bg-hover', it.danger && !it.disabled && 'text-danger', sub?.index === i && 'bg-hover')}
              onMouseEnter={() => {
                setHi(i)
                if (isSub) openSub(i, it)
                else setSub(null)
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (it.disabled) return
                if (isSub) return openSub(i, it)
                it.onSelect?.()
                onClose()
              }}
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-muted">{it.checked ? '✓' : it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="ml-4 text-xs text-muted">{it.shortcut}</span>}
              {isSub && <ChevronRight className="size-3.5 text-muted" />}
            </div>
          )
        })}
      </div>
      {sub && <MenuPanel x={sub.x} y={sub.y} items={sub.items} onClose={onClose} />}
    </>
  )
}
