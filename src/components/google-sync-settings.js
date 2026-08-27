// Settings-section UI for the Google Contacts Sync plugin.
// Rendered inside the sandbox iframe; React is provided by the host runtime.
//
// Connect flow: the background instance receives the OAuth callback through
// the host's authHooks.onOAuthCallback hook (fired by the generic callback
// landing page) and exchanges the code there. This UI only opens the
// authorize URL, then polls connection status until the exchange lands -
// the sandboxed iframe cannot read the callback tab's storage itself.

import React from 'react';
import * as oauth from '../oauth';
import * as syncEngine from '../sync';

const h = React.createElement;

function currentLocale(api) {
  // The sandbox facade exposes the active locale as a property (api.i18n.locale),
  // not a getLocale() method.
  return api.i18n?.locale || 'en';
}

/**
 * The app may be served under a sub-path (basePath). The plugin iframe lives
 * at <base>/plugin-sandbox, so derive the deployment prefix from its own URL.
 */
function appBasePath() {
  return window.location.pathname.replace(/\/plugin-sandbox(-privileged)?(\/.*)?$/, '') || '';
}

function GoogleSyncSettings({ api }) {
  const [connected, setConnected] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [lastSyncAt, setLastSyncAt] = React.useState(null);
  const [contactCount, setContactCount] = React.useState(null);
  const [statusMessage, setStatusMessage] = React.useState(null);
  const [error, setError] = React.useState(null);

  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  // Deployment-wide OAuth client: resolved from Admin Dashboard config
  // (api.admin.getConfig) or the baked-in default. Async because it goes
  // through the host API.
  React.useEffect(() => {
    let stopped = false;
    oauth
      .resolveClientId(api)
      .then((id) => {
        if (!stopped) setClientId(id);
      })
      .catch(() => {
        /* leave empty */
      });
    oauth
      .resolveClientSecret(api)
      .then((secret) => {
        if (!stopped) setClientSecret(secret);
      })
      .catch(() => {
        /* leave empty */
      });
    return () => {
      stopped = true;
    };
  }, [api]);

  const refreshStatus = React.useCallback(async () => {
    try {
      setConnected(await oauth.isConnected(api));
      setLastSyncAt(await api.storage.get('lastSyncAt'));
      const idMap = await api.storage.get('idMap');
      setContactCount(idMap ? Object.keys(idMap).length : 0);
    } catch {
      /* storage unavailable */
    }
  }, [api]);

  React.useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // While a connect flow is pending, poll connection status. The actual token
  // exchange happens in the background instance's onOAuthCallback hook as soon
  // as the user completes Google's consent screen in the other tab.
  React.useEffect(() => {
    if (!connecting) return;
    let stopped = false;

    const tick = async () => {
      try {
        if (!(await api.storage.get('oauth.pkce'))) {
          // No pending flow anymore (consumed, cancelled, or never started).
          if (!stopped) setConnecting(false);
          return;
        }
        if (await oauth.isConnected(api)) {
          if (!stopped) {
            setConnecting(false);
            setError(null);
            api.toast.success('Connected');
            await refreshStatus();
            runSync(false); // kick off the first sync right away
          }
        }
      } catch {
        /* transient storage errors - keep polling */
      }
    };

    const poll = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, api]);

  const runSync = React.useCallback(
    async (full) => {
      if (syncing) return;
      setSyncing(true);
      setError(null);
      setStatusMessage('Syncing…');
      const showToasts = !api.plugin.settings?.showToasts !== false;
      if (showToasts) {
        api.toast.info('Sync in progress…');
      }
      try {
        const result = await syncEngine.sync(api, clientId, { full, clientSecret });
        const doneMsg = `Sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`;
        setStatusMessage(doneMsg);
        if (showToasts) {
          api.toast.success(doneMsg);
        }
        await refreshStatus();
      } catch (e) {
        setStatusMessage(null);
        setError(e.message || String(e));
        if (showToasts) {
          api.toast.error(`Sync failed: ${e.message || String(e)}`);
        }
      } finally {
        setSyncing(false);
      }
    },
    [api, clientId, clientSecret, syncing, refreshStatus]
  );

  const handleConnect = async () => {
    if (!clientId) {
      setError(
        'Google sign-in is not configured on this server yet. An administrator must register an OAuth client once (see the plugin README) - after that, connecting is just one click.'
      );
      return;
    }
    try {
      const locale = currentLocale(api);
      // The host's locale-prefixed plugin OAuth callback landing page.
      const redirectUri = `${window.location.origin}${appBasePath()}/${locale}/plugins/oauth/callback`;
      const url = await oauth.buildAuthorizeUrl(api, clientId, redirectUri);
      await api.ui.openExternalUrl(url);
      setConnecting(true);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const cancelConnect = async () => {
    try {
      await api.storage.remove('oauth.pkce');
    } catch {
      /* ignore */
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    const ok = await api.ui.confirm({
      message: 'Disconnect Google account? Synced contacts stay in the address book.',
    });
    if (!ok) return;
    await oauth.disconnect(api);
    setConnected(false);
    setConnecting(false);
    setStatusMessage(null);
    await refreshStatus();
  };

  const handleFullResync = async () => {
    const ok = await api.ui.confirm({
      message:
        'Run a full resync? This re-fetches all Google contacts and removes local ones that no longer exist in Google.',
    });
    if (!ok) return;
    runSync(true);
  };
  const lastSyncLabel = lastSyncAt
    ? `Last sync: ${new Date(lastSyncAt).toLocaleString(currentLocale(api))}`
    : 'Never synced';

  // SVG Icon Helpers (Lucide matching style)
  const renderIcon = (name) => {
    if (name === 'contact' || name === 'book-user') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: {
            width: '1rem',
            height: '1rem',
            color: 'var(--color-muted-foreground, rgba(128,128,128,0.9))',
          },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M15 13a3 3 0 1 0-6 0' }),
        h('path', {
          d: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20',
        }),
        h('circle', { cx: '12', cy: '8', r: '2' })
      );
    }
    if (name === 'sync' || name === 'refresh-cw') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem' },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
        h('path', { d: 'M21 3v5h-5' }),
        h('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
        h('path', { d: 'M8 16H3v5' })
      );
    }
    if (name === 'full-sync' || name === 'rotate-cw') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem' },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }),
        h('path', { d: 'M21 3v5h-5' })
      );
    }
    if (name === 'power' || name === 'power-off' || name === 'disconnect') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem' },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M18.36 6.64A9 9 0 0 1 20.77 15' }),
        h('path', { d: 'M6.16 6.16a9 9 0 1 0 12.68 12.68' }),
        h('path', { d: 'M12 2v4' }),
        h('path', { d: 'm2 2 20 20' })
      );
    }
    if (name === 'link') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem' },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
        h('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })
      );
    }
    if (name === 'check') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem', flexShrink: 0 },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M20 6 9 17l-5-5' })
      );
    }
    if (name === 'shield') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem', flexShrink: 0 },
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
        })
      );
    }
    if (name === 'loader' || name === 'connecting') {
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: '24',
          height: '24',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { width: '0.875rem', height: '0.875rem', flexShrink: 0 },
          'aria-hidden': 'true',
        },
        h('path', { d: 'M12 2v4' }),
        h('path', { d: 'm16.2 7.8 2.9-2.9' }),
        h('path', { d: 'M18 12h4' }),
        h('path', { d: 'm16.2 16.2 2.9 2.9' }),
        h('path', { d: 'M12 18v4' }),
        h('path', { d: 'm4.9 19.1 2.9-2.9' }),
        h('path', { d: 'M2 12h4' }),
        h('path', { d: 'm4.9 4.9 2.9 2.9' })
      );
    }
    return null;
  };

  // Design tokens aligned with Bulwark Webmail admin & settings layout
  const tokens = {
    foreground: 'var(--color-foreground, #09090b)',
    mutedFg: 'var(--color-muted-foreground, #71717a)',
    border: 'var(--color-border, #e4e4e7)',
    primary: 'var(--color-primary, #18181b)',
    primaryFg: 'var(--color-primary-foreground, #fafafa)',
    primaryHover: 'var(--color-primary-hover, rgba(24, 24, 27, 0.9))',
    destructive: 'var(--color-destructive, #ef4444)',
    muted: 'var(--color-muted, #f4f4f5)',
    mutedHeader: 'color-mix(in srgb, var(--color-muted, #f4f4f5) 30%, transparent)',
    cardBg: 'var(--color-card, #ffffff)',
    radiusSm: 'calc(var(--radius, 0.5rem) - 2px)',
    radiusMd: 'var(--radius, 0.5rem)',
    radiusLg: 'calc(var(--radius, 0.5rem) + 2px)',
    rowPy: 'var(--density-item-py, 0.75rem)',
    cardP: 'var(--density-card-p, 1rem)',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  };

  const headerTitle = {
    fontSize: '1.5rem',
    lineHeight: '2rem',
    fontWeight: 600,
    color: tokens.foreground,
    margin: 0,
    letterSpacing: '-0.02em',
  };

  const headerDesc = {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedFg,
    margin: '0.25rem 0 0',
  };

  const cardStyle = {
    border: `1px solid ${tokens.border}`,
    borderRadius: '0.5rem',
    background: tokens.cardBg,
    overflow: 'hidden',
  };

  const cardHeaderStyle = {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.mutedHeader,
  };

  const cardHeaderTitleRow = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };

  const cardHeaderTitle = {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
    color: tokens.foreground,
    margin: 0,
  };

  const cardHeaderDesc = {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedFg,
    marginTop: '0.125rem',
    marginBottom: 0,
  };

  const divideList = {
    display: 'flex',
    flexDirection: 'column',
  };

  const cardRow = (isLast) => ({
    padding: '0.75rem 1rem',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    borderBottom: isLast ? 'none' : `1px solid ${tokens.border}`,
    flexWrap: 'wrap',
  });

  const rowLabel = {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 400,
    color: tokens.foreground,
    margin: 0,
  };

  const rowSubtext = {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedFg,
    marginTop: '0.125rem',
    marginBottom: 0,
  };

  const controlsRow = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  };

  const buttonStyles = `
    .btn-g-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      height: 2.25rem;
      padding: 0 1rem;
      border-radius: 0.375rem;
      background: var(--color-primary, #18181b);
      color: var(--color-primary-foreground, #fafafa);
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.25rem;
      border: 1px solid transparent;
      cursor: pointer;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      transition: background-color 150ms ease, opacity 150ms ease, transform 100ms ease;
      user-select: none;
    }
    .btn-g-primary:hover:not(:disabled) {
      background: var(--color-primary-hover, color-mix(in srgb, var(--color-primary, #18181b) 85%, transparent));
      opacity: 0.92;
    }
    .btn-g-primary:active:not(:disabled) {
      transform: scale(0.98);
      opacity: 0.85;
    }
    .btn-g-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      height: 1.75rem;
      padding: 0 0.75rem;
      border-radius: 0.375rem;
      background: var(--color-muted, #f4f4f5);
      color: var(--color-muted-foreground, #71717a);
      font-size: 0.75rem;
      font-weight: 500;
      line-height: 1rem;
      border: 1px solid var(--color-border, #e4e4e7);
      cursor: pointer;
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 100ms ease;
      user-select: none;
    }
    .btn-g-secondary:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-muted, #f4f4f5) 80%, black 5%);
      color: var(--color-foreground, #09090b);
      border-color: color-mix(in srgb, var(--color-border, #e4e4e7) 80%, black 10%);
    }
    .btn-g-secondary:active:not(:disabled) {
      transform: scale(0.97);
    }
    .btn-g-destructive {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      height: 1.75rem;
      padding: 0 0.75rem;
      border-radius: 0.375rem;
      background: color-mix(in srgb, var(--color-destructive, #ef4444) 10%, transparent);
      color: var(--color-destructive, #ef4444);
      font-size: 0.75rem;
      font-weight: 500;
      line-height: 1rem;
      border: 1px solid color-mix(in srgb, var(--color-destructive, #ef4444) 20%, transparent);
      cursor: pointer;
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 100ms ease;
      user-select: none;
    }
    .btn-g-destructive:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-destructive, #ef4444) 20%, transparent);
      border-color: color-mix(in srgb, var(--color-destructive, #ef4444) 40%, transparent);
    }
    .btn-g-destructive:active:not(:disabled) {
      transform: scale(0.97);
    }
    .btn-disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
      pointer-events: none !important;
    }
  `;

  // Status badge component matching the app's badge look & feel
  // - not connected: neutral color
  // - connecting: blue color
  // - connected: green color
  // - link icon across states
  // - only status text
  const renderBadge = (state, statusText) => {
    let bg = 'rgba(128, 128, 128, 0.08)';
    let borderColor = 'var(--color-border, rgba(128, 128, 128, 0.3))';
    let accentColor = 'var(--color-muted-foreground, #71717a)';

    if (state === 'connected' || state === 'green' || state === 'success') {
      bg = 'rgba(34, 197, 94, 0.07)';
      borderColor = 'rgba(34, 197, 94, 0.3)';
      accentColor = 'var(--color-badge-green, #16a34a)';
    } else if (state === 'connecting' || state === 'blue') {
      bg = 'rgba(59, 130, 246, 0.07)';
      borderColor = 'rgba(59, 130, 246, 0.3)';
      accentColor = 'var(--color-badge-blue, #2563eb)';
    } else {
      // not connected / neutral
      bg = 'rgba(128, 128, 128, 0.08)';
      borderColor = 'var(--color-border, rgba(128, 128, 128, 0.3))';
      accentColor = 'var(--color-muted-foreground, #71717a)';
    }

    const badgeContainer = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.375rem',
      padding: '0.25rem 0.5rem',
      borderRadius: '0.375rem',
      border: `1px solid ${borderColor}`,
      background: bg,
      fontSize: '0.75rem',
      lineHeight: '1rem',
    };

    const iconEl = h(
      'span',
      {
        style: {
          color: accentColor,
          display: 'inline-flex',
          alignItems: 'center',
        },
      },
      renderIcon('link')
    );

    const statusEl = h(
      'span',
      {
        style: {
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
          color: accentColor,
        },
      },
      statusText
    );

    return h('span', { style: badgeContainer }, iconEl, statusEl);
  };

  const bannerStyle = {
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    borderRadius: "0.375rem",
    padding: "0.5rem 0.75rem",
  };
  const bannerSuccess = {
    backgroundColor: "#ecfdf5",
    color: "#047857",
    "@media (prefers-color-scheme: dark)": {
      backgroundColor: "rgb(2 44 34 / 30%)",
      color: "#6ee7b7",
    },
  };
  const bannerError = {
    background: 'color-mix(in srgb, var(--color-destructive, #ef4444) 15%, transparent)',
    color: 'var(--color-destructive, #b91c1c)',
  };

  return h(
    'div',
    { style: containerStyle },
    h('style', { dangerouslySetInnerHTML: { __html: buttonStyles } }),
    // Page Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
        },
      },
      h(
        'div',
        { style: { minWidth: 0 } },
        h('h1', { style: headerTitle }, 'Google Contacts Sync'),
        h(
          'p',
          { style: headerDesc },
          'One-way sync of your Google Contacts into a dedicated address book.'
        )
      )
    ),

    // Feedback banner (success / info / error)
    statusMessage && h('div', { style: { ...bannerStyle, ...bannerSuccess } }, statusMessage),
    error && h('div', { style: { ...bannerStyle, ...bannerError } }, error),

    // Card 1: Account Status & Connection
    h(
      'div',
      { style: cardStyle },
      h(
        'div',
        { style: cardHeaderStyle },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            },
          },
          h(
            'div',
            { style: { minWidth: 0, display: 'flex', flexDirection: 'column' } },
            h(
              'div',
              { style: cardHeaderTitleRow },
              renderIcon('contact'),
              h('h2', { style: cardHeaderTitle }, 'Account Connection')
            ),
            h(
              'p',
              { style: cardHeaderDesc },
              'Manage your Google account authorization and sync status'
            )
          ),
          h(
            'div',
            { style: controlsRow },
            !connected &&
            !connecting &&
            h(
              'button',
              {
                type: 'button',
                className: 'btn-g-primary',
                onClick: handleConnect,
              },
              renderIcon('link'),
              'Connect Google Account'
            ),
            connecting &&
            h(
              'button',
              {
                type: 'button',
                className: 'btn-g-secondary',
                onClick: cancelConnect,
              },
              'Cancel'
            ),
            connected &&
            h(
              'button',
              {
                type: 'button',
                className: `btn-g-destructive ${syncing ? 'btn-disabled' : ''}`,
                onClick: handleDisconnect,
                disabled: syncing,
              },
              renderIcon('disconnect'),
              'Disconnect'
            )
          )
        )
      ),
      h(
        'div',
        { style: divideList },
        h(
          'div',
          { style: cardRow(false) },
          h(
            'div',
            null,
            h('span', { style: rowLabel }, 'Google Account'),
            h(
              'p',
              { style: rowSubtext },
              connected
                ? 'Authorized and ready for synchronization'
                : connecting
                  ? 'Authorization in progress…'
                  : 'No account connected'
            )
          ),
          h(
            'div',
            { style: controlsRow },
            connected
              ? renderBadge('connected', 'Verbunden')
              : connecting
                ? renderBadge('connecting', 'Wird verbunden…')
                : renderBadge('neutral', 'Nicht verbunden')
          )
        ),
        h(
          'div',
          { style: cardRow(true) },
          h(
            'div',
            null,
            h('span', { style: rowLabel }, 'Synced Contacts'),
            h('p', { style: rowSubtext }, lastSyncLabel)
          ),
          h(
            'div',
            { style: controlsRow },
            h(
              'span',
              {
                style: {
                  fontSize: '0.875rem',
                  fontWeight: 400,
                  color: tokens.foreground,
                },
              },
              contactCount !== null ? `${contactCount} contacts` : '0 contacts'
            )
          )
        )
      )
    ),

    // Card 2: Synchronization Actions
    h(
      'div',
      { style: cardStyle },
      h(
        'div',
        { style: cardHeaderStyle },
        h(
          'div',
          { style: cardHeaderTitleRow },
          renderIcon('sync'),
          h('h2', { style: cardHeaderTitle }, 'Synchronization')
        ),
        h(
          'p',
          { style: cardHeaderDesc },
          'Perform manual synchronization or full resync with Google'
        )
      ),
      h(
        'div',
        { style: divideList },
        h(
          'div',
          { style: cardRow(false) },
          h(
            'div',
            null,
            h('span', { style: rowLabel }, 'Sync Now'),
            h(
              'p',
              { style: rowSubtext },
              'Pull incremental updates and changes from Google Contacts'
            )
          ),
          h(
            'div',
            { style: controlsRow },
            h(
              'button',
              {
                type: 'button',
                className: `btn-g-secondary ${!connected || syncing ? 'btn-disabled' : ''}`,
                onClick: () => runSync(false),
                disabled: !connected || syncing,
              },
              renderIcon('sync'),
              syncing ? 'Syncing…' : 'Sync Now'
            )
          )
        ),
        h(
          'div',
          { style: cardRow(true) },
          h(
            'div',
            null,
            h('span', { style: rowLabel }, 'Full Resync'),
            h(
              'p',
              { style: rowSubtext },
              'Re-fetch all Google contacts and remove local ones that no longer exist'
            )
          ),
          h(
            'div',
            { style: controlsRow },
            h(
              'button',
              {
                type: 'button',
                className: `btn-g-secondary ${!connected || syncing ? 'btn-disabled' : ''}`,
                onClick: handleFullResync,
                disabled: !connected || syncing,
              },
              renderIcon('full-sync'),
              'Full Resync'
            )
          )
        )
      )
    )
  );
}

export { GoogleSyncSettings };
