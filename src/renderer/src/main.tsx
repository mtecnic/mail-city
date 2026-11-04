import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles/globals.css'

/** A render error in one view must not blank the whole window. */
class RootBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('render error', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-sm">
        <div className="font-semibold">Something went wrong in the interface.</div>
        <pre className="max-w-xl overflow-auto rounded border border-border bg-panel p-3 text-xs">{String(this.state.error?.message ?? this.state.error)}</pre>
        <button className="rounded bg-accent px-3 py-1 text-white" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootBoundary>
        <App />
      </RootBoundary>
    </QueryClientProvider>
  </React.StrictMode>
)
