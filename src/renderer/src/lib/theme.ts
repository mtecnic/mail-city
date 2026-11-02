import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke, onEvent } from './api'
import type { AppSettings } from '@shared/schemas/settings'

function apply(theme: AppSettings['theme']) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): void {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => invoke('settings.get') })
  useEffect(() => {
    if (settings.data) apply(settings.data.theme)
  }, [settings.data])
  useEffect(() => onEvent('settings.changed', (s) => apply(s.theme)), [])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => settings.data && apply(settings.data.theme)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [settings.data])
}
