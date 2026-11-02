# Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Commit and tag: `git tag v1.2.3 && git push --tags`.
3. The `Release` workflow builds the NSIS installer + portable exe on `windows-latest` and publishes them to the GitHub Release with the `latest.yml` manifest that `electron-updater` consumes.
4. Repository secrets used at build time (all optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID` (baked-in OAuth defaults). Without them, users paste their own client IDs in Settings.

## Code signing

Unsigned installers trigger Windows SmartScreen ("unknown publisher"). To sign, add `CSC_LINK` (base64 PFX) and `CSC_KEY_PASSWORD` secrets and electron-builder signs automatically; an EV certificate avoids the reputation warm-up period.

## Smoke test before tagging

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm test:e2e
pnpm dist:dir   # unpacked app in release/win-unpacked
```
