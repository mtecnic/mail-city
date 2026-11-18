/**
 * Pane sizes and sidebar collapse, remembered per machine. localStorage can be unavailable
 * or cleared, so every access is guarded and the defaults always work.
 */
import { create } from 'zustand'

export type Pane = 'sidebar' | 'list' | 'assistant'

/** [min, max, default] widths in pixels. */
export const PANE_LIMITS: Record<Pane, readonly [number, number, number]> = {
  sidebar: [180, 420, 240],
  list: [280, 760, 380],
  assistant: [300, 680, 380]
}
export const COLLAPSED_SIDEBAR_WIDTH = 56

export function clampWidth(pane: Pane, w: number): number {
  const [min, max, def] = PANE_LIMITS[pane]
  if (!Number.isFinite(w)) return def
  return Math.round(Math.min(max, Math.max(min, w)))
}

/** Move a list item from one index to before/after another (account drag and drop). */
export function reorder<T>(list: T[], from: number, to: number, after: boolean): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  let target = to > from ? to - 1 : to
  if (after) target += 1
  next.splice(target, 0, item!)
  return next
}

const KEY = 'mailcity.layout.v1'

interface Saved {
  sidebar: number
  list: number
  assistant: number
  sidebarCollapsed: boolean
}

function load(): Saved {
  const d: Saved = { sidebar: PANE_LIMITS.sidebar[2], list: PANE_LIMITS.list[2], assistant: PANE_LIMITS.assistant[2], sidebarCollapsed: false }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    if (!raw) return d
    return {
      sidebar: clampWidth('sidebar', raw.sidebar ?? d.sidebar),
      list: clampWidth('list', raw.list ?? d.list),
      assistant: clampWidth('assistant', raw.assistant ?? d.assistant),
      sidebarCollapsed: !!raw.sidebarCollapsed
    }
  } catch {
    return d
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: layout just isn't remembered */
  }
}

interface LayoutState extends Saved {
  setWidth(pane: Pane, w: number): void
  reset(pane: Pane): void
  toggleSidebar(): void
}

export const useLayout = create<LayoutState>((set, get) => {
  const persist = () => {
    const { sidebar, list, assistant, sidebarCollapsed } = get()
    save({ sidebar, list, assistant, sidebarCollapsed })
  }
  return {
    ...load(),
    setWidth: (pane, w) => {
      set({ [pane]: clampWidth(pane, w) } as Partial<Saved>)
      persist()
    },
    reset: (pane) => {
      set({ [pane]: PANE_LIMITS[pane][2] } as Partial<Saved>)
      persist()
    },
    toggleSidebar: () => {
      set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
      persist()
    }
  }
})
