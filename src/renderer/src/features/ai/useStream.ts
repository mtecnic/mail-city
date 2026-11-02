import { useCallback, useEffect, useRef, useState } from 'react'
import { onEvent } from '@renderer/lib/api'

/** Collects `ai.stream` deltas for a streamId into live text. */
export function useAiStream() {
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const idRef = useRef<string | null>(null)

  useEffect(
    () =>
      onEvent('ai.stream', (e) => {
        if (e.streamId !== idRef.current) return
        const d = e.delta
        if (d.type === 'text') setText((t) => t + d.text)
      }),
    []
  )

  const begin = useCallback(() => {
    const id = `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    idRef.current = id
    setText('')
    setStreaming(true)
    return id
  }, [])
  const end = useCallback(() => {
    idRef.current = null
    setStreaming(false)
  }, [])

  return { text, streaming, begin, end, setText }
}
