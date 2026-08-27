# Google Contacts Sync (Bulwark Webmail Plugin)

**Google Contacts Sync** is an plugin for [Bulwark Webmail](https://github.com/bulwark/bulwarkwebmail) that provides one-way synchronization of your Google Contacts into a dedicated **"Google Contacts"** address book inside Bulwark.

## What This Project Does

- **One-Way Synchronization**: Automatically pulls contacts from your Google account and keeps them up to date in Bulwark Webmail.
- **Smart Incremental & Full Sync**: Uses Google People API `syncToken` for lightweight incremental updates, alongside periodically triggered full syncs to reliably detect and propagate contact deletions.
- **Background & Triggered Sync**: Automatically syncs on application start, login, and window focus, throttled by a user-customizable minimum interval (default: 15 minutes).
- **Secure OAuth 2.0 with PKCE**: Authorization happens directly between the user's browser and Google via OAuth 2.0 PKCE. Bulwark server never sees or stores user Google passwords.
- **Seamless User Experience**: Server administrators configure the OAuth client credentials once; end users simply click **Connect** and authorize their Google account.

## Production Setup & Deployment (Administrator Guide)

Setting up the plugin in a production Bulwark Webmail deployment requires two steps: creating a Google Cloud OAuth client and configuring the credentials in Bulwark.

### 1. Google Cloud Console Setup (Once per Server)

A single Google Cloud OAuth client serves the entire Bulwark deployment. Every user on your server authorizes their personal Google account through this shared client.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one) and enable the **Google People API** under **APIs & Services → Enabled APIs & Services**.
3. Configure the **OAuth consent screen** (under **APIs & Services → OAuth consent screen**):
   - Choose **External** (or **Internal** if using Google Workspace for an organization).
   - Add the required scope: `https://www.googleapis.com/auth/contacts` (or `.../auth/contacts.readonly`).
4. Create OAuth credentials under **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - **Application type**: *Web application*
   - **Name**: e.g., `Bulwark Webmail Contacts Sync`
   - **Authorized JavaScript origins**: Your webmail domain, e.g.:
     ```
     https://mail.example.com
     ```
   - **Authorized redirect URIs**: Add the plugin OAuth callback endpoint for each supported locale (at least `/en`), e.g.:
     ```
     https://mail.example.com/en/plugins/oauth/callback
     https://mail.example.com/de/plugins/oauth/callback
     ```
5. Note the generated **Client ID** and **Client Secret**.

### 2. Configure in Bulwark Webmail

Supply the credentials:

1. Log into Bulwark Webmail Admin Dashboard.
2. Navigate to **Admin Dashboard → Plugins → Google Contacts Sync → Settings**.
3. Enter the **Google OAuth Client ID** and **Google OAuth Client Secret**.
4. Save changes.

## User Guide: How to Connect & Use

Once the server administrator has configured the OAuth client, connecting is quick and simple for any mailbox user:

1. Log into your Bulwark Webmail account.
2. Go to **Settings → Plugins** and ensure **Google Contacts Sync** is enabled (accepting permissions for contacts access and external HTTP requests if prompted).
3. Navigate to **Settings → Google Contacts Sync** in the settings menu.
4. Click **Connect Google Account**.
5. A Google sign-in window will open. Select your Google account and grant permission to read contacts.
6. Once authorization completes, the window closes and your contacts will automatically begin syncing into your **"Google Contacts"** address book.

## Development & Local Testing Notes

When running Bulwark Webmail locally (e.g. `http://localhost:3000` via `PLUGIN_DEV_DIR=../bulwarkwebmail-plugins`):

> **⚠️ OAuth Callback in Local Development:**
> Google OAuth **requires a reachable, valid HTTPS (or explicitly configured localhost) redirect URI** matching what is registered in the Google Cloud Console (e.g. `http://localhost:3000/en/plugins/oauth/callback`).
>
> If you are running locally without a public hostname or valid registered localhost OAuth client:
> - You can register `http://localhost:3000` (origins) and `http://localhost:3000/en/plugins/oauth/callback` (redirect URI) in the Google Cloud Console for local testing.
> - Alternatively, use a tunnel service (like ngrok or Cloudflare Tunnel) to provide an accessible HTTPS domain for your development instance, and add that domain's callback URL to your authorized redirect URIs.

For internal codebase structure and component breakdown, refer to [AGENTS.md](./AGENTS.md).

## How the OAuth Handoff Works Under the Hood

1. When the user clicks **Connect**, the plugin generates a random PKCE code verifier and challenge, stashes them in plugin storage, and opens Google's OAuth consent endpoint with the client ID, redirect URI, and PKCE challenge.
2. Upon user consent, Google redirects back to Bulwark's generic OAuth callback page (`/[locale]/plugins/oauth/callback`).
3. The callback landing page captures `{ code, state }` and signals the plugin host via the `authHooks.onOAuthCallback` hook.
4. The plugin background instance validates `state` against the stashed PKCE verifier and exchanges the authorization code for tokens via `api.http.fetch` directly against Google endpoints. Bulwark server never sees Google credentials.
