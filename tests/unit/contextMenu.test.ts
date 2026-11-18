import { describe, it, expect, vi } from 'vitest'
import { buildContextMenuTemplate, searchQueryFor, type ContextParams, type ContextActions } from '../../src/main/contextMenu'

const base: ContextParams = {
  x: 10,
  y: 20,
  isEditable: false,
  selectionText: '',
  linkURL: '',
  mediaType: 'none',
  srcURL: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
}
function actions(): ContextActions & Record<string, ReturnType<typeof vi.fn>> {
  return { replaceMisspelling: vi.fn(), addToDictionary: vi.fn(), openExternal: vi.fn(), copyText: vi.fn(), composeTo: vi.fn(), searchMail: vi.fn(), copyImageAt: vi.fn(), saveImage: vi.fn() } as never
}
const labels = (t: ReturnType<typeof buildContextMenuTemplate>) => t.map((i) => i.label ?? i.role ?? i.type)

describe('native context menu', () => {
  it('shows nothing where there is nothing to act on', () => {
    expect(buildContextMenuTemplate(base, actions())).toEqual([])
  })

  it('gives text fields the edit menu and spelling fixes first', () => {
    const a = actions()
    const t = buildContextMenuTemplate({ ...base, isEditable: true, misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] }, a)
    expect(labels(t)).toEqual(['receive', 'relieve', 'Add “recieve” to dictionary', 'separator', 'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'Paste as plain text', 'separator', 'selectAll'])
    t[0]!.click!(undefined as never, undefined, undefined as never)
    expect(a.replaceMisspelling).toHaveBeenCalledWith('receive')
    expect(t.find((i) => i.role === 'redo')!.enabled).toBe(false)
  })

  it('offers copy and search for selected message text', () => {
    const a = actions()
    const t = buildContextMenuTemplate({ ...base, selectionText: '  quarterly   report ' }, a)
    expect(labels(t)).toEqual(['copy', 'Search mail for "quarterly report"'])
    t[1]!.click!(undefined as never, undefined, undefined as never)
    expect(a.searchMail).toHaveBeenCalledWith('"quarterly report"')
  })

  it('handles web links, mailto links and images', () => {
    const a = actions()
    expect(labels(buildContextMenuTemplate({ ...base, linkURL: 'https://example.com/x' }, a))).toEqual(['Open link in browser', 'Copy link address'])
    const mail = buildContextMenuTemplate({ ...base, linkURL: 'mailto:bob%40x.test?subject=Hi' }, a)
    expect(labels(mail)).toEqual(['Compose to bob@x.test', 'Copy email address'])
    mail[1]!.click!(undefined as never, undefined, undefined as never)
    expect(a.copyText).toHaveBeenCalledWith('bob@x.test')
    expect(labels(buildContextMenuTemplate({ ...base, mediaType: 'image', srcURL: 'data:image/png;base64,AAA' }, a))).toEqual(['Copy image', 'Save image as…'])
    // Never act on other schemes.
    expect(buildContextMenuTemplate({ ...base, linkURL: 'javascript:alert(1)' }, a)).toEqual([])
    expect(buildContextMenuTemplate({ ...base, mediaType: 'image', srcURL: 'file:///etc/passwd' }, a)).toEqual([])
  })

  it('builds compact search queries', () => {
    expect(searchQueryFor('invoice')).toBe('invoice')
    expect(searchQueryFor('say "hi"\nthere')).toBe('"say hi there"')
    expect(searchQueryFor('x'.repeat(100))).toHaveLength(60)
  })
})
