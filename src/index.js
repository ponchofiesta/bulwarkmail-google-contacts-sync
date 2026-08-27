// Google Contacts Sync — Bulwark Webmail plugin entry point.
//
// One-way sync (Google → Bulwark) into a dedicated "Google Contacts" address
// book. See manifest.json for permissions and settings schema.
//
// Bundle contract: CommonJS (`module.exports = { slots, hooks, activate }`),
// evaluated by the sandbox runtime with React/ReactDOM injected. External
// modules: react, @plugin-host.

import pluginHost from '@plugin-host';
import React from 'react';
import { GoogleSyncSettings } from './components/google-sync-settings';
import * as oauth from './oauth';
import * as syncEngine from './sync';

async function settings(api) {
  // One OAuth client serves the whole server; users never enter it. It comes
  // from the deployment config (Admin Dashboard) or the baked-in default.
  const clientId = await oauth.resolveClientId(api);
  const clientSecret = await oauth.resolveClientSecret(api);
  const pluginSettings = api.plugin.settings || {};
  const intervalMinutes = pluginSettings.syncIntervalMinutes || 15;
  const syncOnLogin = pluginSettings.syncOnLogin !== false;
  const syncPeriodically = pluginSettings.syncPeriodically !== false;
  const showToasts = pluginSettings.showToasts !== false;
  return { clientId, clientSecret, intervalMinutes, syncOnLogin, syncPeriodically, showToasts };
}

let isSyncing = false;

async function triggerBackgroundSync(api, reason) {
  if (isSyncing) return;
  try {
    const { clientId, clientSecret, intervalMinutes, syncOnLogin, syncPeriodically, showToasts } =
      await settings(api);
    if (!clientId) return;

    if (reason === 'login' && !syncOnLogin) return;
    if ((reason === 'app_start' || reason === 'window_focus') && !syncPeriodically) return;

    const connected = await oauth.isConnected(api);
    if (!connected) return;

    if (reason === 'window_focus') {
      const shouldSync = await syncEngine.shouldAutoSync(api, intervalMinutes);
      if (!shouldSync) return;
    }

    isSyncing = true;
    if (showToasts) {
      api.toast.info('Sync in progress…');
    }

    api.log.info(`Running background Google Contacts Sync (trigger: ${reason})`);
    const result = await syncEngine.sync(api, clientId, { clientSecret });
    if (showToasts) {
      const doneMsg = `Google Contacts Sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`;
      api.toast.success(doneMsg);
    }
  } catch (e) {
    api.log.warn(`Background Google Contacts Sync failed (trigger: ${reason}):`, e.message);
    const { showToasts } = await settings(api).catch(() => ({ showToasts: false }));
    if (showToasts) {
      api.toast.error(`Google Contacts Sync failed: ${e.message || String(e)}`);
    }
  } finally {
    isSyncing = false;
  }
}

export async function activate(api) {
  api.log.info('Google Contacts Sync plugin activated');
  triggerBackgroundSync(api, 'app_start').catch(() => {});
}
export const slots = {
  'settings-section': {
    // The sandbox runtime injects the per-plugin API as '@plugin-host' in
    // both slot and background modes.
    component: () => {
      const api = getPluginHostApi();
      return React.createElement(GoogleSyncSettings, { api });
    },
    order: 100,
  },
};

function getPluginHostApi() {
  return pluginHost;
}

export const hooks = {
  // When user logs in, trigger sync if syncOnLogin is enabled.
  onLogin: () => {
    const api = getPluginHostApi();
    if (api) triggerBackgroundSync(api, 'login').catch(() => {});
  },
  // When app becomes ready, trigger sync if syncPeriodically is enabled.
  onAppReady: () => {
    const api = getPluginHostApi();
    if (api) triggerBackgroundSync(api, 'app_start').catch(() => {});
  },
  // Periodical sync check triggered when browser window receives focus.
  onWindowFocus: () => {
    const api = getPluginHostApi();
    if (api) triggerBackgroundSync(api, 'window_focus').catch(() => {});
  },
  // The host fires this (via authHooks.onOAuthCallback) when the generic
  // OAuth callback landing page receives the provider redirect. Validate
  // the state, exchange the code, then run the first sync immediately.
  onOAuthCallback: (payload) => {
    const api = getPluginHostApi();
    if (!api) return;
    settings(api)
      .then(({ clientId, clientSecret }) => {
        if (!clientId) return;
        return oauth
          .completeOAuthCallback(api, clientId, payload, clientSecret)
          .then((consumed) => {
            if (!consumed) return; // not our flow (state mismatch / no pending flow)
            api.log.info('OAuth flow completed - running initial sync');
            return syncEngine.sync(api, clientId, { clientSecret }).catch((e) => {
              api.log.warn('Post-connect sync failed:', e.message);
            });
          });
      })
      .catch((e) => {
        api.log.warn('OAuth callback handling failed:', e.message);
      });
  },
};
