import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { folderOfCached } from '@renderer/features/mail/hooks'

const item = (id: string, folderId: string) => ({ id, folderId })

describe('undo bookkeeping', () => {
  it('records where each message was, from any cached list, thread or message', () => {
    const qc = new QueryClient()
    qc.setQueryData(['messages', { specialUse: 'inbox' }], { pages: [[item('m1', 'inbox'), item('m2', 'inbox')]], pageParams: [undefined] })
    qc.setQueryData(['thread', 't1', null], [item('m3', 'sent')])
    qc.setQueryData(['message', 'm4'], { id: 'm4', folderId: 'work' })
    const before = folderOfCached(qc, ['m1', 'm3', 'm4', 'unknown'])
    expect([...before]).toEqual([
      ['m4', 'work'],
      ['m3', 'sent'],
      ['m1', 'inbox']
    ])
  })
})
