/**
 * Per-account sync worker entry point (runs in an Electron utilityProcess).
 * Implemented in Phase 3; the file exists now so the build graph is stable.
 */
process.parentPort?.on('message', (e) => {
  if (e.data?.type === 'ping') process.parentPort.postMessage({ type: 'pong' })
})
