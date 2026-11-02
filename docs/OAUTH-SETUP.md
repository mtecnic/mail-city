# OAuth setup (Google & Microsoft)

Gmail and Outlook.com / Microsoft 365 no longer accept plain passwords over IMAP, so Mail City signs in with OAuth 2.0 and then uses the resulting token for IMAP/SMTP (XOAUTH2). This needs an OAuth *client* registered with each provider. You can:

- use the client IDs baked into a build (`.env` → `MAIN_VITE_*`, see `.env.example`), or
- create your own and paste them in **Settings → Accounts → OAuth clients** (recommended for personal builds — takes 5 minutes and avoids the 7-day refresh-token expiry of someone else's "Testing" app).

Tokens are stored encrypted with the OS keystore (DPAPI on Windows). The renderer process never sees them.

## Google

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Mail City").
2. **APIs & Services → OAuth consent screen**: External, fill in the app name and your email. Add the scope `https://mail.google.com/`. Under **Test users**, add every Google account you'll sign in with.
   - While the app is in *Testing*, refresh tokens expire after **7 days** and you'll have to sign in again. Click **Publish app** to lift that (Google will show an "unverified app" warning on sign-in because the Gmail scope is restricted; that's fine for personal use — click *Advanced → Go to Mail City*).
3. **Credentials → Create credentials → OAuth client ID**, type **Desktop app**. Copy the Client ID and Client secret into Mail City.

Mail City uses the loopback redirect (`http://127.0.0.1:<random port>/callback`) with PKCE, which Desktop clients allow automatically.

### Alternative: app passwords

If you'd rather not set up OAuth, enable 2-Step Verification on the Google account and create an **App password** (Google Account → Security → App passwords). Use it as the password in the add-account wizard. Google Workspace admins may have disabled this.

## Microsoft

1. Go to <https://entra.microsoft.com/> → **Applications → App registrations → New registration**.
2. Name: "Mail City". Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (so both Outlook.com and work accounts work).
3. Redirect URI: platform **Mobile and desktop applications**, URI `http://localhost`.
4. After creating, under **Authentication** make sure *Allow public client flows* is **Yes**.
5. **API permissions → Add a permission → APIs my organization uses → "Office 365 Exchange Online"** (or search `outlook.office.com`): delegated `IMAP.AccessAsUser.All` and `SMTP.Send`. Add `offline_access` from Microsoft Graph.
6. Copy the **Application (client) ID** into Mail City. Tenant stays `common` unless your admin requires a specific tenant id.

Microsoft 365 admins can disable IMAP for a tenant; if sign-in succeeds but the IMAP test fails with `AUTHENTICATE failed`, ask your admin to enable IMAP (Exchange admin center → Mailboxes → Email apps).

## iCloud / Yahoo / Fastmail / Zoho

These use app-specific passwords; the wizard links to the right help page for each.
