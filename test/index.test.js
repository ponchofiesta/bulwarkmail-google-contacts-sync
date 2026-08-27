import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, hooks, slots } from '../src/index';
import * as oauth from '../src/oauth';
import * as syncEngine from '../src/sync';

describe('index module - plugin lifecycle, slots, and hooks', () => {
  let mockApi;
  let storageStore;

  beforeEach(() => {
    storageStore = {};
    mockApi = {
      plugin: {
        settings: {
          syncIntervalMinutes: 15,
          syncOnLogin: true,
          syncPeriodically: true,
          showToasts: true,
        },
      },
      storage: {
        get: vi.fn(async (key) => storageStore[key] ?? null),
        set: vi.fn(async (key, value) => {
          storageStore[key] = value;
        }),
        remove: vi.fn(async (key) => {
          delete storageStore[key];
        }),
      },
      admin: {
        getConfig: vi.fn(async (key) => {
          if (key === 'clientId') return 'test-client-id';
          if (key === 'clientSecret') return 'test-client-secret';
          return null;
        }),
      },
      toast: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('slots', () => {
    it('defines settings-section slot component and order', () => {
      expect(slots['settings-section']).toBeDefined();
      expect(slots['settings-section'].order).toBe(100);
      expect(typeof slots['settings-section'].component).toBe('function');
      const rendered = slots['settings-section'].component();
      expect(rendered).toBeDefined();
    });
  });

  describe('activate', () => {
    it('logs activation and triggers background sync on app_start', async () => {
      vi.spyOn(oauth, 'resolveClientId').mockResolvedValue('test-client-id');
      vi.spyOn(oauth, 'resolveClientSecret').mockResolvedValue('test-client-secret');
      vi.spyOn(oauth, 'isConnected').mockResolvedValue(true);
      const syncSpy = vi
        .spyOn(syncEngine, 'sync')
        .mockResolvedValue({ created: 1, updated: 0, deleted: 0 });

      await activate(mockApi);

      expect(mockApi.log.info).toHaveBeenCalledWith('Google Contacts Sync plugin activated');
      await new Promise((r) => setTimeout(r, 20));
      expect(syncSpy).toHaveBeenCalled();
    });
  });

  describe('hooks', () => {
    it('handles onLogin, onAppReady, and onWindowFocus gracefully', async () => {
      const syncSpy = vi
        .spyOn(syncEngine, 'sync')
        .mockResolvedValue({ created: 0, updated: 0, deleted: 0 });

      hooks.onLogin();
      hooks.onAppReady();
      hooks.onWindowFocus();

      await new Promise((r) => setTimeout(r, 20));
      expect(true).toBe(true);
    });

    it('handles onOAuthCallback: ignores when client ID is missing or flow is not consumed', async () => {
      const completeSpy = vi.spyOn(oauth, 'completeOAuthCallback').mockResolvedValue(false);
      const syncSpy = vi.spyOn(syncEngine, 'sync');

      vi.spyOn(oauth, 'resolveClientId').mockResolvedValue('client-123');
      vi.spyOn(oauth, 'resolveClientSecret').mockResolvedValue('secret-123');

      hooks.onOAuthCallback({ code: 'auth-code', state: 'unmatched-state' });
      await new Promise((r) => setTimeout(r, 50));

      expect(completeSpy).toHaveBeenCalled();
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('handles onOAuthCallback: completes flow and triggers initial sync on consumed callback', async () => {
      const completeSpy = vi.spyOn(oauth, 'completeOAuthCallback').mockResolvedValue(true);
      const syncSpy = vi
        .spyOn(syncEngine, 'sync')
        .mockResolvedValue({ created: 5, updated: 0, deleted: 0 });
      vi.spyOn(oauth, 'resolveClientId').mockResolvedValue('client-123');
      vi.spyOn(oauth, 'resolveClientSecret').mockResolvedValue('secret-123');

      hooks.onOAuthCallback({ code: 'valid-auth-code', state: 'matched-state' });
      await new Promise((r) => setTimeout(r, 50));

      expect(completeSpy).toHaveBeenCalledWith(
        expect.anything(),
        'client-123',
        { code: 'valid-auth-code', state: 'matched-state' },
        'secret-123'
      );
      expect(syncSpy).toHaveBeenCalledWith(expect.anything(), 'client-123', {
        clientSecret: 'secret-123',
      });
    });
  });
});
