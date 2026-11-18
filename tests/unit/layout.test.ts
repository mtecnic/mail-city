import { describe, it, expect } from 'vitest'
import { clampWidth, reorder, PANE_LIMITS } from '@renderer/store/layout'

describe('pane layout', () => {
  it('clamps widths to each pane’s limits and falls back to the default', () => {
    const [min, max, def] = PANE_LIMITS.list
    expect(clampWidth('list', 10)).toBe(min)
    expect(clampWidth('list', 10_000)).toBe(max)
    expect(clampWidth('list', 401.6)).toBe(402)
    expect(clampWidth('list', Number.NaN)).toBe(def)
  })

  it('reorders accounts by dropping above or below another', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(reorder(ids, 0, 2, false)).toEqual(['b', 'a', 'c', 'd']) // a above c
    expect(reorder(ids, 0, 2, true)).toEqual(['b', 'c', 'a', 'd']) // a below c
    expect(reorder(ids, 3, 0, false)).toEqual(['d', 'a', 'b', 'c']) // d above a
    expect(reorder(ids, 3, 1, true)).toEqual(['a', 'b', 'd', 'c']) // d below b
    expect(reorder(ids, 1, 1, true)).toBe(ids) // dropped on itself
    expect(reorder(ids, 9, 1, true)).toBe(ids)
  })
})
