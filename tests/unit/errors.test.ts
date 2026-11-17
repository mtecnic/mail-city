import { describe, it, expect } from 'vitest'
import { isTransientNetworkError } from '@kernel/utils/errors'

describe('isTransientNetworkError', () => {
  it('recognises what a sleeping laptop and flaky Wi-Fi produce', () => {
    for (const m of ['read ECONNRESET', 'connect ETIMEDOUT 1.2.3.4:993', 'getaddrinfo ENOTFOUND imap.example.com', 'getaddrinfo EAI_AGAIN smtp.gmail.com', 'write EPIPE', 'Socket timeout', 'Connection closed unexpectedly', 'Connection not available', 'socket hang up', 'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NETWORK_CHANGED', 'Client network socket disconnected before secure TLS connection was established', 'Request timed out'])
      expect(isTransientNetworkError(new Error(m)), m).toBe(true)
  })

  it('reads the error code as well as the message', () => {
    const e = Object.assign(new Error('failed'), { code: 'ECONNRESET' })
    expect(isTransientNetworkError(e)).toBe(true)
    expect(isTransientNetworkError('ETIMEDOUT')).toBe(true)
  })

  it('does not hide real problems', () => {
    for (const m of ['Invalid credentials', 'Authentication failed', 'AUTHENTICATIONFAILED', 'Cannot read properties of undefined', 'SQLITE_CONSTRAINT: UNIQUE constraint failed', 'Command failed: NO [SERVERBUG] Internal error', 'Mailbox does not exist'])
      expect(isTransientNetworkError(new Error(m)), m).toBe(false)
  })
})
