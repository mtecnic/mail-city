import type { MessageStructureObject } from 'imapflow'

export interface AttachmentInfo {
  part: string
  filename: string
  mimeType: string
  size: number
  contentId: string | null
  isInline: boolean
}

/** Walk a BODYSTRUCTURE and list non-text parts that look like attachments. */
export function listAttachments(node: MessageStructureObject | undefined, acc: AttachmentInfo[] = []): AttachmentInfo[] {
  if (!node) return acc
  if (node.childNodes?.length) {
    for (const c of node.childNodes) listAttachments(c, acc)
    return acc
  }
  const type = (node.type ?? 'application/octet-stream').toLowerCase()
  const disposition = (node.disposition ?? '').toLowerCase()
  const filename = node.dispositionParameters?.['filename'] ?? node.parameters?.['name']
  const isText = type === 'text/plain' || type === 'text/html'
  if (isText && disposition !== 'attachment') return acc
  if (!node.part) return acc
  const inline = disposition === 'inline' && !!node.id
  acc.push({
    part: node.part,
    filename: filename ?? defaultFilename(type, node.part),
    mimeType: type,
    size: node.size ?? 0,
    contentId: node.id ? node.id.replace(/^<|>$/g, '') : null,
    isInline: inline
  })
  return acc
}

function defaultFilename(type: string, part: string): string {
  const ext = type.split('/')[1]?.split('+')[0] ?? 'bin'
  return `part-${part}.${ext}`
}

export function hasRealAttachments(list: AttachmentInfo[]): boolean {
  return list.some((a) => !a.isInline)
}
