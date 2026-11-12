# Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Commit and tag: `git tag v1.2.3 && git push --tags`.
3. The `Release` workflow (also runnable by hand from the Actions tab via **Run workflow**) builds the NSIS installer + portable exe on `windows-latest` and attaches them to a **draft** GitHub Release together with the `latest.yml` manifest that `electron-updater` consumes. Open the draft on the Releases page, check the files, and click **Publish release**; installed copies only see the update once it is published.
4. Repository secrets used at build time (all optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID` (baked-in OAuth defaults). Without them, users paste their own client IDs in Settings.

Every push to any branch also builds the installer in CI (`build-windows` job) and uploads it as the `mail-city-windows-installer` artifact (kept 14 days), so a ready-to-run installer exists for every commit without tagging.

## Code signing

Unsigned installers trigger Windows SmartScreen ("unknown publisher"). To sign, add `CSC_LINK` (base64 PFX) and `CSC_KEY_PASSWORD` secrets and electron-builder signs automatically; an EV certificate avoids the reputation warm-up period.

## Smoke test before tagging

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm test:e2e
pnpm dist:dir   # unpacked app in release/win-unpacked
```
