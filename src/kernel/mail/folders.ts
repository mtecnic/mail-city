export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'important'

const SPECIAL_ORDER: SpecialUse[] = ['inbox', 'flagged', 'important', 'drafts', 'sent', 'archive', 'all', 'junk', 'trash']

export function specialUseFromImap(flag: string | undefined, path: string): SpecialUse | null {
  if (path.toUpperCase() === 'INBOX') return 'inbox'
  switch ((flag ?? '').toLowerCase()) {
    case '\\inbox':
      return 'inbox'
    case '\\sent':
      return 'sent'
    case '\\drafts':
      return 'drafts'
    case '\\trash':
      return 'trash'
    case '\\junk':
      return 'junk'
    case '\\archive':
      return 'archive'
    case '\\all':
      return 'all'
    case '\\flagged':
      return 'flagged'
    case '\\important':
      return 'important'
    default:
      return null
  }
}

export function folderSortKey(specialUse: string | null, path: string): string {
  const idx = specialUse ? SPECIAL_ORDER.indexOf(specialUse as SpecialUse) : -1
  return `${idx >= 0 ? String(idx).padStart(2, '0') : '99'}:${path.toLowerCase()}`
}

/** Folders synced eagerly on first connect; others sync lazily when opened. */
export const EAGER_SPECIAL_USE: SpecialUse[] = ['inbox', 'sent', 'drafts']
