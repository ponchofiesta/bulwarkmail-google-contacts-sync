# Agent Reference: Google Contacts Sync Plugin

## Project Architecture & Source Layout

```
manifest.json                     # plugin manifest (entrypoint: index.js)
src/index.js                      # entry point (slots, hooks, activate)
src/oauth.js                      # PKCE + Google OAuth flow helpers
src/google-people.js              # People API connections client
src/mapper.js                     # Google person -> JSContact ContactCard
src/sync.js                       # sync engine (upsert / delete diff)
src/components/google-sync-settings.js   # settings-section UI
```

## Bundling & Development Notes

The multi-file CommonJS source is bundled on demand: in dev mode Bulwark runs
esbuild on `src/<entrypoint>` (CJS, externalising `react*` / `@plugin-host`),
so editing any file under `src/` and refreshing the browser is enough.

## Component Overview

- **`manifest.json`**: Declares plugin metadata, permissions (`contacts:read`, `contacts:write`, `http:fetch`, `ui:settings-section`, `admin:config`, `crypto:full`), `httpOrigins` allowlist (`oauth2.googleapis.com`, `people.googleapis.com`), `configSchema` (admin-configurable OAuth Client ID and Secret), and `settingsSchema` (user preferences for sync interval, login sync, toasts, address book name).
- **`src/index.js`**: Main plugin lifecycle entrypoint. Registers the settings section slot, sets up event hooks (`authHooks.onOAuthCallback` for token exchange, periodic/login/focus sync hooks), and initialises background sync.
- **`src/oauth.js`**: Implements OAuth 2.0 Authorization Code flow with PKCE (RFC 7636). Contains a standalone pure-JS SHA-256 implementation, authorization URL builder, code-for-token exchange, token refresher, and token storage helpers.
- **`src/google-people.js`**: Google People API client for listing and batch-fetching connections, managing `syncToken` pagination, and fetching profile contact details.
- **`src/mapper.js`**: Maps Google People API Person objects into standard JSContact (`ContactCard` format used by Bulwark Contacts API).
- **`src/sync.js`**: Core sync orchestrator. Manages initial full syncs, incremental syncs using `syncToken`, conflict resolution, deletion detection, and syncing into the dedicated Bulwark address book.
- **`src/components/google-sync-settings.js`**: React component rendered in the settings UI sandbox iframe. Provides connect/disconnect buttons, manual sync trigger, sync statistics, status messages, and admin configuration guidance.
