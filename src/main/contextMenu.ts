/**
 * Native right-click menu for the places the renderer does not handle itself: text fields
 * (cut/copy/paste and spelling), selected text, and links and images inside a message.
 * The renderer's own menus call preventDefault, so Electron only reaches this handler
 * where no custom menu applies.
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/** The subset of Electron's ContextMenuParams the menu depends on (keeps the builder testable). */
export interface ContextParams {
  x: number
  y: number
  isEditable: boolean
  selectionText: string
  linkURL: string
  mediaType: string
  srcURL: string
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export interface ContextActions {
  replaceMisspelling(word: string): void
  addToDictionary(word: string): void
  openExternal(url: string): void
  copyText(text: string): void
  composeTo(mailtoUrl: string): void
  searchMail(query: string): void
  copyImageAt(x: number, y: number): void
  saveImage(url: string): void
}

const sep: MenuItemConstructorOptions = { type: 'separator' }

function mailtoAddress(url: string): string {
  try {
    return decodeURIComponent(url.slice('mailto:'.length).split('?')[0] ?? '')
  } catch {
    return url.slice('mailto:'.length).split('?')[0] ?? ''
  }
}

/** A search query for selected text: one line, at most 60 characters, quoted when it has spaces. */
export function searchQueryFor(selection: string): string {
  const one = selection.replace(/\s+/g, ' ').replace(/"/g, '').trim().slice(0, 60).trim()
  return /\s/.test(one) ? `"${one}"` : one
}

export function buildContextMenuTemplate(p: ContextParams, a: ContextActions): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = []

  if (p.isEditable && p.misspelledWord) {
    const fixes = p.dictionarySuggestions.slice(0, 5).map<MenuItemConstructorOptions>((s) => ({ label: s, click: () => a.replaceMisspelling(s) }))
    groups.push([...(fixes.length ? fixes : [{ label: 'No spelling suggestions', enabled: false }]), { label: `Add “${p.misspelledWord}” to dictionary`, click: () => a.addToDictionary(p.misspelledWord) }])
  }

  const link = p.linkURL
  if (link && /^mailto:/i.test(link)) {
    const addr = mailtoAddress(link)
    groups.push([
      { label: `Compose to ${addr || 'address'}`, click: () => a.composeTo(link) },
      { label: 'Copy email address', click: () => a.copyText(addr) }
    ])
  } else if (link && /^https?:/i.test(link)) {
    groups.push([
      { label: 'Open link in browser', click: () => a.openExternal(link) },
      { label: 'Copy link address', click: () => a.copyText(link) }
    ])
  }

  if (p.mediaType === 'image' && p.srcURL && /^(https?:|data:image\/|blob:)/i.test(p.srcURL)) {
    groups.push([
      { label: 'Copy image', click: () => a.copyImageAt(p.x, p.y) },
      { label: 'Save image as…', click: () => a.saveImage(p.srcURL) }
    ])
  }

  if (p.isEditable) {
    groups.push([
      { role: 'undo', enabled: p.editFlags.canUndo },
      { role: 'redo', enabled: p.editFlags.canRedo },
      sep,
      { role: 'cut', enabled: p.editFlags.canCut },
      { role: 'copy', enabled: p.editFlags.canCopy },
      { role: 'paste', enabled: p.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: p.editFlags.canPaste },
      sep,
      { role: 'selectAll', enabled: p.editFlags.canSelectAll }
    ])
  } else if (p.selectionText.trim()) {
    const q = searchQueryFor(p.selectionText)
    groups.push([
      { role: 'copy' },
      { label: `Search mail for ${q.length > 30 ? `${q.slice(0, 30)}…` : q}`, click: () => a.searchMail(q) }
    ])
  }

  return groups.flatMap((g, i) => (i === 0 ? g : [sep, ...g]))
}

export function installContextMenu(win: BrowserWindow, handlers: { composeTo(mailtoUrl: string): void; searchMail(query: string): void; openExternal(url: string): void; copyText(text: string): void }): void {
  win.webContents.on('context-menu', (_e, params) => {
    const template = buildContextMenuTemplate(params, {
      ...handlers,
      replaceMisspelling: (w) => win.webContents.replaceMisspelling(w),
      addToDictionary: (w) => win.webContents.session.addWordToSpellCheckerDictionary(w),
      copyImageAt: (x, y) => win.webContents.copyImageAt(x, y),
      saveImage: (url) => win.webContents.downloadURL(url)
    })
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win })
  })
}
