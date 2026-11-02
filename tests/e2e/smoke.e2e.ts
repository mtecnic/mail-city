/**
 * Playwright-Electron smoke test: boots the built app against a temp profile,
 * checks the welcome screen, settings navigation and the add-account wizard.
 * Run with `pnpm test:e2e` (needs `pnpm build` first; uses xvfb on Linux CI).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page
let userData: string

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mail-city-e2e-'))
  app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js'), '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production', MAIL_CITY_E2E: '1' },
    timeout: 60_000
  })
  page = await app.firstWindow({ timeout: 60_000 })
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[renderer ${m.type()}] ${m.text()}`)
  })
  page.on('pageerror', (e) => console.error(`[renderer pageerror] ${e.message}`))
  await page.waitForLoadState('domcontentloaded')
}, 90_000)

afterAll(async () => {
  await Promise.race([app?.close(), new Promise((r) => setTimeout(r, 10_000))])
  try {
    app?.process().kill()
  } catch {
    /* already gone */
  }
  rmSync(userData, { recursive: true, force: true })
}, 30_000)

describe('Mail City smoke', () => {
  it('shows the welcome screen on first run', async () => {
    await expect.poll(() => page.locator('text=Welcome to Mail City').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await page.title()).toBe('Mail City')
  })

  it('opens the add-account wizard and discovers Gmail settings offline', async () => {
    await page.getByRole('button', { name: 'Add your first account' }).click()
    await page.getByPlaceholder('you@example.com').fill('someone@gmail.com')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect.poll(() => page.locator('text=Google (Gmail / Workspace)').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => page.locator('text=Google (Gmail / Workspace)').count()).toBe(0)
  })

  it('navigates settings sections', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    for (const section of ['AI', 'MCP / agents', 'Rules', 'Contacts', 'General']) {
      await page.getByRole('button', { name: section, exact: true }).click()
    }
    await expect.poll(() => page.locator('text=Check for updates').count()).toBeGreaterThan(0)
    await page.getByText('Back to mail').click()
  })

  it('exposes the typed IPC bridge but not Node', async () => {
    const result = await page.evaluate(() => ({ hasMail: typeof (window as unknown as { mail?: unknown }).mail === 'object', hasRequire: typeof (window as unknown as { require?: unknown }).require, hasProcess: typeof (window as unknown as { process?: unknown }).process }))
    expect(result).toEqual({ hasMail: true, hasRequire: 'undefined', hasProcess: 'undefined' })
    const version = await page.evaluate(() => (window as unknown as { mail: { invoke: (c: string) => Promise<{ version: string }> } }).mail.invoke('app.version'))
    expect(version.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
