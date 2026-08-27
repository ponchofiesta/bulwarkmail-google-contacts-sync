import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  completeOAuthCallback,
  disconnect,
  exchangeCode,
  getAccessToken,
  isConnected,
  resolveClientId,
  resolveClientSecret,
  SCOPE,
} from '../src/oauth';

describe('oauth module', () => {
  let mockApi;
  let storageStore;

  beforeEach(() => {
    storageStore = {};
    mockApi = {
      storage: {
        get: vi.fn(async (key) => storageStore[key] || null),
        set: vi.fn(async (key, value) => {
          storageStore[key] = value;
        }),
        remove: vi.fn(async (key) => {
          delete storageStore[key];
        }),
      },
      http: {
        fetch: vi.fn(),
      },
      admin: {
        getConfig: vi.fn(),
      },
    };
  });

  describe('resolveClientId and resolveClientSecret', () => {
    it('returns client ID from api.admin.getConfig if available', async () => {
      mockApi.admin.getConfig.mockResolvedValueOnce('admin-client-id-123');
      const clientId = await resolveClientId(mockApi);
      expect(clientId).toBe('admin-client-id-123');
      expect(mockApi.admin.getConfig).toHaveBeenCalledWith('clientId');
    });

    it('returns empty string if admin config throws or is not available and no default is set', async () => {
      mockApi.admin.getConfig.mockRejectedValueOnce(new Error('Permission denied'));
      const clientId = await resolveClientId(mockApi);
      expect(clientId).toBe('');
    });

    it('returns client secret from api.admin.getConfig if available', async () => {
      mockApi.admin.getConfig.mockResolvedValueOnce('admin-client-secret-xyz');
      const clientSecret = await resolveClientSecret(mockApi);
      expect(clientSecret).toBe('admin-client-secret-xyz');
      expect(mockApi.admin.getConfig).toHaveBeenCalledWith('clientSecret');
    });

    it('returns empty string if resolving client secret fails', async () => {
      mockApi.admin.getConfig.mockRejectedValueOnce(new Error('Permission denied'));
      const secret = await resolveClientSecret(mockApi);
      expect(secret).toBe('');
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('generates an authorization URL with PKCE challenge, state, and stashes pkce info in storage', async () => {
      const clientId = 'test-client-123';
      const redirectUri = 'https://webmail.example.com/en/plugins/oauth/callback';

      const authUrlStr = await buildAuthorizeUrl(mockApi, clientId, redirectUri);
      const authUrl = new URL(authUrlStr);

      expect(authUrl.origin + authUrl.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth'
      );
      expect(authUrl.searchParams.get('client_id')).toBe(clientId);
      expect(authUrl.searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(authUrl.searchParams.get('response_type')).toBe('code');
      expect(authUrl.searchParams.get('scope')).toBe(SCOPE);
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authUrl.searchParams.get('access_type')).toBe('offline');
      expect(authUrl.searchParams.get('prompt')).toBe('consent');

      const challenge = authUrl.searchParams.get('code_challenge');
      const state = authUrl.searchParams.get('state');
      expect(challenge).toBeTruthy();
      expect(state).toBeTruthy();

      expect(mockApi.storage.set).toHaveBeenCalledWith('oauth.pkce', {
        verifier: expect.any(String),
        state,
        redirectUri,
      });
    });
  });

  describe('exchangeCode', () => {
    it('throws error if no pending PKCE flow exists in storage', async () => {
      await expect(exchangeCode(mockApi, 'client-id', 'auth-code-123')).rejects.toThrow(
        'No pending OAuth flow'
      );
    });

    it('throws error if redirectUri is missing in PKCE storage', async () => {
      storageStore['oauth.pkce'] = { verifier: 'verifier-123' };
      await expect(exchangeCode(mockApi, 'client-id', 'auth-code-123')).rejects.toThrow(
        'Missing redirect URI'
      );
    });

    it('successfully exchanges code for tokens, saves tokens to storage, and removes pkce', async () => {
      storageStore['oauth.pkce'] = {
        verifier: 'test-verifier-123',
        redirectUri: 'https://example.com/callback',
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          access_token: 'google-access-token-abc',
          refresh_token: 'google-refresh-token-xyz',
          expires_in: 3600,
        }),
      });

      const res = await exchangeCode(mockApi, 'client-id', 'auth-code-123', 'explicit-secret');
      expect(res).toBe(true);

      expect(mockApi.http.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('grant_type=authorization_code'),
      });

      const bodyParams = new URLSearchParams(mockApi.http.fetch.mock.calls[0][1].body);
      expect(bodyParams.get('code')).toBe('auth-code-123');
      expect(bodyParams.get('client_id')).toBe('client-id');
      expect(bodyParams.get('code_verifier')).toBe('test-verifier-123');
      expect(bodyParams.get('client_secret')).toBe('explicit-secret');

      expect(mockApi.storage.set).toHaveBeenCalledWith('oauth.tokens', {
        accessToken: 'google-access-token-abc',
        refreshToken: 'google-refresh-token-xyz',
        expiresAt: expect.any(Number),
      });
      expect(mockApi.storage.remove).toHaveBeenCalledWith('oauth.pkce');
    });

    it('throws error if token endpoint returns an error response', async () => {
      storageStore['oauth.pkce'] = {
        verifier: 'test-verifier-123',
        redirectUri: 'https://example.com/callback',
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        bodyText: JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired' }),
      });

      await expect(exchangeCode(mockApi, 'client-id', 'auth-code-123')).rejects.toThrow(
        /Token exchange failed \(400\)/
      );
    });

    it('throws error if token response is missing access_token', async () => {
      storageStore['oauth.pkce'] = {
        verifier: 'test-verifier-123',
        redirectUri: 'https://example.com/callback',
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({}),
      });

      await expect(exchangeCode(mockApi, 'client-id', 'auth-code-123')).rejects.toThrow(
        'Token response missing access_token'
      );
    });
  });

  describe('getAccessToken', () => {
    it('throws "Not connected" if no tokens exist in storage', async () => {
      await expect(getAccessToken(mockApi, 'client-id')).rejects.toThrow('Not connected');
    });

    it('returns existing access token directly if it is still valid (> 30s remaining)', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
      };

      const token = await getAccessToken(mockApi, 'client-id');
      expect(token).toBe('valid-token');
      expect(mockApi.http.fetch).not.toHaveBeenCalled();
    });

    it('throws "Session expired — reconnect Google" if token is expired and no refresh token exists', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'expired-token',
        refreshToken: null,
        expiresAt: Date.now() - 1000,
      };

      await expect(getAccessToken(mockApi, 'client-id')).rejects.toThrow(
        'Session expired — reconnect Google'
      );
    });

    it('refreshes token using refresh_token when expired', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token-123',
        expiresAt: Date.now() - 1000,
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      });

      const token = await getAccessToken(mockApi, 'client-id', 'secret-val');
      expect(token).toBe('new-access-token');

      expect(mockApi.storage.set).toHaveBeenCalledWith('oauth.tokens', {
        accessToken: 'new-access-token',
        refreshToken: 'refresh-token-123',
        expiresAt: expect.any(Number),
      });
    });

    it('throws error if token refresh HTTP call fails', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token-123',
        expiresAt: Date.now() - 1000,
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        bodyText: 'invalid_grant',
      });

      await expect(getAccessToken(mockApi, 'client-id')).rejects.toThrow(
        'Token refresh failed (400)'
      );
    });
  });

  describe('disconnect and isConnected', () => {
    it('disconnect removes oauth.tokens and oauth.pkce from storage', async () => {
      storageStore['oauth.tokens'] = { accessToken: 'abc' };
      storageStore['oauth.pkce'] = { verifier: '123' };

      await disconnect(mockApi);

      expect(mockApi.storage.remove).toHaveBeenCalledWith('oauth.tokens');
      expect(mockApi.storage.remove).toHaveBeenCalledWith('oauth.pkce');
      expect(storageStore['oauth.tokens']).toBeUndefined();
      expect(storageStore['oauth.pkce']).toBeUndefined();
    });

    it('isConnected returns true if accessToken exists in storage', async () => {
      storageStore['oauth.tokens'] = { accessToken: 'token-abc' };
      expect(await isConnected(mockApi)).toBe(true);
    });

    it('isConnected returns false if no accessToken exists in storage', async () => {
      storageStore['oauth.tokens'] = {};
      expect(await isConnected(mockApi)).toBe(false);

      delete storageStore['oauth.tokens'];
      expect(await isConnected(mockApi)).toBe(false);
    });
  });

  describe('completeOAuthCallback', () => {
    it('returns false if payload has no code', async () => {
      const result = await completeOAuthCallback(mockApi, 'client-id', {});
      expect(result).toBe(false);
    });

    it('returns false if no pending pkce flow exists in storage', async () => {
      const result = await completeOAuthCallback(mockApi, 'client-id', {
        code: 'code123',
        state: 'state123',
      });
      expect(result).toBe(false);
    });

    it('returns false if state in payload does not match stored state', async () => {
      storageStore['oauth.pkce'] = { state: 'expected-state', verifier: 'v', redirectUri: 'u' };
      const result = await completeOAuthCallback(mockApi, 'client-id', {
        code: 'code123',
        state: 'different-state',
      });
      expect(result).toBe(false);
    });

    it('successfully completes exchange and returns true if state matches', async () => {
      storageStore['oauth.pkce'] = {
        state: 'matching-state',
        verifier: 'v123',
        redirectUri: 'https://example.com/callback',
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
      });

      const result = await completeOAuthCallback(
        mockApi,
        'client-id',
        { code: 'auth-code-123', state: 'matching-state' },
        'secret'
      );

      expect(result).toBe(true);
      expect(mockApi.storage.set).toHaveBeenCalledWith('oauth.tokens', expect.any(Object));
    });
  });
});
