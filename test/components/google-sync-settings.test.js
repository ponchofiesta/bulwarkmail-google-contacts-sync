import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleSyncSettings } from '../../src/components/google-sync-settings';
import * as syncEngine from '../../src/sync';

describe('GoogleSyncSettings component', () => {
  let mockApi;
  let storageStore;

  beforeEach(() => {
    storageStore = {};
    mockApi = {
      i18n: { locale: 'en' },
      plugin: {
        settings: {
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
      ui: {
        openExternalUrl: vi.fn(async () => {}),
        confirm: vi.fn(async () => true),
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
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders disconnected state with connect button when not connected', async () => {
    storageStore['oauth.tokens'] = null;

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    await waitFor(() => {
      expect(screen.getByText('No account connected')).toBeDefined();
      expect(screen.getByRole('button', { name: /^Connect Google Account$/i })).toBeDefined();
    });
  });

  it('shows error if Connect is clicked but no Client ID is configured', async () => {
    mockApi.admin.getConfig.mockResolvedValue(null);

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const connectBtn = await screen.findByRole('button', { name: /^Connect Google Account$/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Google sign-in is not configured on this server yet/i)
      ).toBeDefined();
    });
  });

  it('starts connect flow, opens auth URL, and renders Cancel button when Connect is clicked with valid client ID', async () => {
    mockApi.admin.getConfig.mockImplementation(async (k) => {
      if (k === 'clientId') return 'valid-client-id';
      return null;
    });

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const connectBtn = await screen.findByRole('button', { name: /^Connect Google Account$/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(mockApi.ui.openExternalUrl).toHaveBeenCalledWith(
        expect.stringContaining('https://accounts.google.com/o/oauth2/v2/auth')
      );
      expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeDefined();
    });
  });

  it('cancels connecting when Cancel button is clicked', async () => {
    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const connectBtn = await screen.findByRole('button', { name: /^Connect Google Account$/i });
    fireEvent.click(connectBtn);

    const cancelBtn = await screen.findByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(mockApi.storage.remove).toHaveBeenCalledWith('oauth.pkce');
      expect(screen.queryByRole('button', { name: /^Cancel$/i })).toBeNull();
      expect(screen.getByRole('button', { name: /^Connect Google Account$/i })).toBeDefined();
    });
  });

  it('renders connected state with contact count and sync options when connected', async () => {
    storageStore['oauth.tokens'] = { accessToken: 'valid-token' };
    storageStore.idMap = { 'people/c1': 'local1', 'people/c2': 'local2' };
    storageStore.lastSyncAt = Date.now() - 3600_000;

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    await waitFor(() => {
      expect(screen.getByText('Authorized and ready for synchronization')).toBeDefined();
      expect(screen.getByText('2 contacts')).toBeDefined();
      expect(screen.getByRole('button', { name: /^Sync Now$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Full Resync$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Disconnect$/i })).toBeDefined();
    });
  });

  it('triggers manual sync when "Sync Now" button is clicked', async () => {
    storageStore['oauth.tokens'] = { accessToken: 'valid-token' };
    const syncSpy = vi.spyOn(syncEngine, 'sync').mockResolvedValueOnce({
      created: 2,
      updated: 1,
      deleted: 0,
    });

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const syncBtn = await screen.findByRole('button', { name: /^Sync Now$/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith(
        mockApi,
        'test-client-id',
        expect.objectContaining({ full: false, clientSecret: 'test-client-secret' })
      );
      expect(screen.getByText(/Sync complete: 2 created, 1 updated, 0 deleted/i)).toBeDefined();
    });
  });

  it('prompts confirmation and runs full resync when "Full Resync" is clicked', async () => {
    storageStore['oauth.tokens'] = { accessToken: 'valid-token' };
    const syncSpy = vi.spyOn(syncEngine, 'sync').mockResolvedValueOnce({
      created: 3,
      updated: 0,
      deleted: 1,
    });

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const resyncBtn = await screen.findByRole('button', { name: /^Full Resync$/i });
    fireEvent.click(resyncBtn);

    await waitFor(() => {
      expect(mockApi.ui.confirm).toHaveBeenCalledWith({
        message: expect.stringContaining('Run a full resync?'),
      });
      expect(syncSpy).toHaveBeenCalledWith(
        mockApi,
        'test-client-id',
        expect.objectContaining({ full: true, clientSecret: 'test-client-secret' })
      );
    });
  });

  it('disconnects Google account when Disconnect button is confirmed', async () => {
    storageStore['oauth.tokens'] = { accessToken: 'valid-token' };

    render(React.createElement(GoogleSyncSettings, { api: mockApi }));

    const disconnectBtn = await screen.findByRole('button', { name: /^Disconnect$/i });
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(mockApi.ui.confirm).toHaveBeenCalledWith({
        message: expect.stringContaining('Disconnect Google account?'),
      });
      expect(mockApi.storage.remove).toHaveBeenCalledWith('oauth.tokens');
      expect(screen.getByRole('button', { name: /^Connect Google Account$/i })).toBeDefined();
    });
  });
});
