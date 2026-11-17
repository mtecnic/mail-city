import { describe, it, expect } from 'vitest'
import { TypedEmitter } from '@kernel/utils/emitter'

class Probe extends TypedEmitter<{ error: [Error]; ping: [number] }> {}

describe('TypedEmitter', () => {
  it('does not throw when an error event has no listener', () => {
    const e = new Probe()
    expect(() => e.emit('error', new Error('socket died'))).not.toThrow()
  })

  it('still delivers error events to listeners', () => {
    const e = new Probe()
    const seen: string[] = []
    e.on('error', (err) => seen.push(err.message))
    e.emit('error', new Error('boom'))
    expect(seen).toEqual(['boom'])
  })
})
