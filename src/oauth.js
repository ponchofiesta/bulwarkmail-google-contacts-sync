// OAuth 2.0 PKCE helpers for the Google Contacts Sync plugin.
//
// The untrusted sandbox tier has no crypto.subtle, so the PKCE code challenge
// (S256) is computed with a bundled pure-JS SHA-256 implementation.

// ─── Pure-JS SHA-256 (public domain style, compact) ──────────

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(bytes) {
  // Pre-processing: padding to 56 mod 64, then 8-byte big-endian bit length.
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const H = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Int32Array(64);
  const m = new DataView(padded.buffer);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = m.getInt32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setInt32(i * 4, H[i], false);
  return out;
}

// ─── base64url ────────────────────────────────────────────────

function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToBytes(str) {
  // UTF-8 encode without TextEncoder dependency guarantees in the sandbox.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      // Surrogate pair
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
        i++;
      } else {
        out.push(0xef, 0xbf, 0xbd); // replacement char
      }
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function randomBase64url(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

// ─── PKCE ─────────────────────────────────────────────────────

async function pkceChallenge(verifier) {
  return bytesToBase64url(sha256Bytes(strToBytes(verifier)));
}

// ─── Google OAuth flow ────────────────────────────────────────

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/contacts';

/**
 * Deployment-wide OAuth client. One client is registered once for the whole
 * Bulwark server (redirect URI: <origin>/<locale>/plugins/oauth/callback) and
 * is shared by ALL users - each user still authorizes individually and gets
 * their own tokens. End users never see or enter this ID; they only click
 * "Connect Google account".
 *
 * Set this at build/package time for your deployment, or leave empty and let
 * the administrator override it via the plugin's deployment settings.
 */
const DEFAULT_CLIENT_ID = '';
const DEFAULT_CLIENT_SECRET = '';

/**
 * Build the Google authorize URL and stash the PKCE verifier + state in
 * plugin storage. Returns the URL for api.ui.openExternalUrl.
 */
async function buildAuthorizeUrl(api, clientId, redirectUri) {
  const verifier = randomBase64url(48);
  const state = randomBase64url(24);
  const challenge = await pkceChallenge(verifier);
  await api.storage.set('oauth.pkce', { verifier, state, redirectUri });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // offline access so we get a refresh token; consent forces it on repeat runs
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

/**
 * Exchange the authorization code for tokens. Stores the token bundle in
 * plugin storage. Throws on failure.
 */
async function exchangeCode(api, clientId, code, clientSecret) {
  const pkce = await api.storage.get('oauth.pkce');
  if (!pkce?.verifier) throw new Error('No pending OAuth flow');
  if (!pkce.redirectUri) throw new Error('Missing redirect URI');

  const secret = clientSecret !== undefined ? clientSecret : await resolveClientSecret(api);

  const params = {
    code,
    client_id: clientId,
    redirect_uri: pkce.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: pkce.verifier,
  };
  if (secret) {
    params.client_secret = secret;
  }

  const body = new URLSearchParams(params).toString();

  const res = await api.http.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = res.bodyText ? res.bodyText.slice(0, 200) : '';
    throw new Error(`Token exchange failed (${res.status}) ${detail}`);
  }
  const tokens = JSON.parse(res.bodyText);
  if (!tokens.access_token) throw new Error('Token response missing access_token');

  await api.storage.set('oauth.tokens', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  await api.storage.remove('oauth.pkce');
  return true;
}

/**
 * Return a valid access token, refreshing when expired. Throws when no
 * refresh token is available and the access token has expired (user must
 reconnect).
 */
async function getAccessToken(api, clientId, clientSecret) {
  const tokens = await api.storage.get('oauth.tokens');
  if (!tokens?.accessToken) throw new Error('Not connected');

  if (tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error('Session expired — reconnect Google');

  const secret = clientSecret !== undefined ? clientSecret : await resolveClientSecret(api);

  const params = {
    client_id: clientId,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  };
  if (secret) {
    params.client_secret = secret;
  }

  const body = new URLSearchParams(params).toString();
  const res = await api.http.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const fresh = JSON.parse(res.bodyText);
  const updated = {
    accessToken: fresh.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + (fresh.expires_in ?? 3600) * 1000,
  };
  await api.storage.set('oauth.tokens', updated);
  return updated.accessToken;
}

async function disconnect(api) {
  await api.storage.remove('oauth.tokens');
  await api.storage.remove('oauth.pkce');
}

async function isConnected(api) {
  const tokens = await api.storage.get('oauth.tokens');
  return !!tokens?.accessToken;
}

/**
 * Finish an OAuth flow that was initiated with buildAuthorizeUrl.
 *
 * Called from the background instance's onOAuthCallback hook with the payload
 * the host relayed from the generic callback landing page. Validates `state`
 * against the verifier stashed at redirect time (so concurrent flows from
 * other plugins are ignored), then exchanges the code for tokens.
 *
 * @returns {boolean} true when this plugin consumed the callback
 */
async function completeOAuthCallback(api, clientId, payload, clientSecret) {
  if (!payload?.code) return false;
  const pkce = await api.storage.get('oauth.pkce');
  // No pending flow, or the payload belongs to a different plugin/flow.
  if (!pkce?.state) return false;
  if (payload.state !== pkce.state) return false;

  await exchangeCode(api, clientId, payload.code, clientSecret);
  return true;
}

/**
 * Resolve the OAuth client ID for this deployment:
 * 1. Deployment config set in Admin Dashboard → Plugins → Google Contacts
 *    Sync → Settings (read via api.admin.getConfig; requires the
 *    'admin:config' permission).
 * 2. The baked-in DEFAULT_CLIENT_ID shipped with the plugin.
 *
 * Returns '' when neither is configured - the UI then shows a hint that an
 * administrator must configure the client once for the whole server.
 */
async function resolveClientId(api) {
  let override = null;
  try {
    override = await api.admin.getConfig('clientId');
  } catch {
    /* permission not granted or host without admin namespace */
  }
  return override || DEFAULT_CLIENT_ID || '';
}

/**
 * Resolve the OAuth client secret for this deployment:
 * 1. Deployment config set in Admin Dashboard → Plugins → Google Contacts
 *    Sync → Settings (read via api.admin.getConfig; requires the
 *    'admin:config' permission).
 * 2. The baked-in DEFAULT_CLIENT_SECRET shipped with the plugin.
 *
 * Returns '' when not configured.
 */
async function resolveClientSecret(api) {
  let override = null;
  try {
    override = await api.admin.getConfig('clientSecret');
  } catch {
    /* permission not granted or host without admin namespace */
  }
  return override || DEFAULT_CLIENT_SECRET || '';
}

export {
  buildAuthorizeUrl,
  completeOAuthCallback,
  disconnect,
  exchangeCode,
  getAccessToken,
  isConnected,
  resolveClientId,
  resolveClientSecret,
  SCOPE,
};
