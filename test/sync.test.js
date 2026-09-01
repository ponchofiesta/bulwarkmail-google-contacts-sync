import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ADDRESS_BOOK_NAME, ensureAddressBook, shouldAutoSync, sync } from '../src/sync';

describe('sync module', () => {
  let mockApi;
  let storageStore;

  beforeEach(() => {
    storageStore = {};
    mockApi = {
      plugin: {
        settings: {},
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
      addressBooks: {
        list: vi.fn(async () => []),
        create: vi.fn(async (name) => ({ id: `book-${name}` })),
      },
      contacts: {
        list: vi.fn(async () => []),
        create: vi.fn(async (card) => ({ id: `local-${card.uid}` })),
        update: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      http: {
        fetch: vi.fn(),
      },
      admin: {
        getConfig: vi.fn(),
      },
    };
  });

  describe('ensureAddressBook', () => {
    it('returns existing address book ID if address book with matching name already exists', async () => {
      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-1', name: 'Personal' },
        { id: 'book-2', name: 'Google Contacts' },
      ]);

      const bookId = await ensureAddressBook(mockApi);
      expect(bookId).toBe('book-2');
      expect(mockApi.addressBooks.create).not.toHaveBeenCalled();
    });

    it('creates new address book if none matches default name', async () => {
      mockApi.addressBooks.list.mockResolvedValueOnce([{ id: 'book-1', name: 'Personal' }]);
      mockApi.addressBooks.create.mockResolvedValueOnce({ id: 'new-book-id' });

      const bookId = await ensureAddressBook(mockApi);
      expect(bookId).toBe('new-book-id');
      expect(mockApi.addressBooks.create).toHaveBeenCalledWith(ADDRESS_BOOK_NAME);
    });

    it('uses custom addressBookName from plugin settings if configured', async () => {
      mockApi.plugin.settings.addressBookName = 'My Work Google Contacts';
      mockApi.addressBooks.list.mockResolvedValueOnce([]);
      mockApi.addressBooks.create.mockResolvedValueOnce({ id: 'custom-book-id' });

      const bookId = await ensureAddressBook(mockApi);
      expect(bookId).toBe('custom-book-id');
      expect(mockApi.addressBooks.create).toHaveBeenCalledWith('My Work Google Contacts');
    });
  });

  describe('shouldAutoSync', () => {
    it('returns true if never synced before (no lastSyncAt in storage)', async () => {
      const result = await shouldAutoSync(mockApi, 15);
      expect(result).toBe(true);
    });

    it('returns true if elapsed time is greater than or equal to interval', async () => {
      const twentyMinsAgo = Date.now() - 20 * 60 * 1000;
      storageStore.lastSyncAt = twentyMinsAgo;

      const result = await shouldAutoSync(mockApi, 15);
      expect(result).toBe(true);
    });

    it('returns false if elapsed time is less than interval', async () => {
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      storageStore.lastSyncAt = fiveMinsAgo;

      const result = await shouldAutoSync(mockApi, 15);
      expect(result).toBe(false);
    });
  });

  describe('sync workflow', () => {
    it('performs initial full sync: creates new contacts and saves syncToken, idMap, and lastSyncAt', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [
            {
              resourceName: 'people/c101',
              names: [{ displayName: 'Alice' }],
              emailAddresses: [{ value: 'alice@example.com' }],
            },
            {
              resourceName: 'people/c102',
              names: [{ displayName: 'Bob' }],
              emailAddresses: [{ value: 'bob@example.com' }],
            },
          ],
          nextSyncToken: 'sync-token-123',
        }),
      });

      mockApi.contacts.create
        .mockResolvedValueOnce({ id: 'local-alice' })
        .mockResolvedValueOnce('local-bob'); // test handling non-object / direct ID return too

      const result = await sync(mockApi, 'client-id-1');

      expect(result).toEqual({ created: 2, updated: 0, deleted: 0 });
      expect(mockApi.contacts.create).toHaveBeenCalledTimes(2);

      expect(storageStore.syncToken).toBe('sync-token-123');
      expect(storageStore.idMap).toEqual({
        'people/c101': 'local-alice',
        'people/c102': 'local-bob',
      });
      expect(typeof storageStore.lastSyncAt).toBe('number');
    });

    it('updates existing contact when idMap already has entry for resourceName', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };
      storageStore.syncToken = 'existing-sync-token';
      storageStore.idMap = {
        'people/c101': 'local-alice-id',
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);
      mockApi.contacts.list.mockResolvedValueOnce([
        { id: 'local-alice-id', uid: 'urn:uuid:gcs-peoplec101' },
      ]);

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [
            {
              resourceName: 'people/c101',
              names: [{ displayName: 'Alice Updated' }],
            },
          ],
          nextSyncToken: 'sync-token-456',
        }),
      });

      const result = await sync(mockApi, 'client-id-1');

      expect(result).toEqual({ created: 0, updated: 1, deleted: 0 });
      expect(mockApi.contacts.update).toHaveBeenCalledWith(
        'local-alice-id',
        expect.objectContaining({
          name: expect.objectContaining({ full: 'Alice Updated' }),
        })
      );
      expect(mockApi.contacts.create).not.toHaveBeenCalled();
    });

    it('falls back to upsert and creates contact if updating previously known contact fails', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };
      storageStore.syncToken = 'sync-token';
      storageStore.idMap = {
        'people/c101': 'deleted-local-id',
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);
      mockApi.contacts.list.mockResolvedValueOnce([]); // local contact was deleted locally

      mockApi.http.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            resourceName: 'people/c101',
            names: [{ displayName: 'Alice' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            connections: [
              {
                resourceName: 'people/c101',
                names: [{ displayName: 'Alice' }],
              },
            ],
            nextSyncToken: 'new-token',
          }),
        });

      mockApi.contacts.create.mockResolvedValue({ id: 'recreated-local-id' });

      const result = await sync(mockApi, 'client-id-1');
      expect(result.created).toBeGreaterThanOrEqual(1);
    });

    it('handles UID conflicts on create by extracting existing ID from error message', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);
      mockApi.contacts.list.mockResolvedValueOnce([]);

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [
            {
              resourceName: 'people/c101',
              names: [{ displayName: 'Alice' }],
            },
          ],
        }),
      });

      mockApi.contacts.create.mockRejectedValueOnce(
        new Error('Contact with UID already exists with id conflict-id-123.')
      );

      const result = await sync(mockApi, 'client-id-1');

      expect(mockApi.contacts.update).toHaveBeenCalledWith('conflict-id-123', expect.any(Object));
      expect(storageStore.idMap['people/c101']).toBe('conflict-id-123');
      expect(result.created).toBe(1);
    });

    it('handles UID conflicts on create by listing address book when error message has no ID', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);
      mockApi.contacts.list.mockResolvedValue([
        { id: 'found-id-456', uid: 'urn:uuid:gcs-peoplec101' },
      ]);

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [
            {
              resourceName: 'people/c101',
              names: [{ displayName: 'Alice' }],
            },
          ],
        }),
      });

      mockApi.contacts.create.mockRejectedValueOnce(new Error('Generic duplicate UID conflict'));

      const result = await sync(mockApi, 'client-id-1');

      expect(mockApi.contacts.update).toHaveBeenCalledWith('found-id-456', expect.any(Object));
      expect(storageStore.idMap['people/c101']).toBe('found-id-456');
      expect(result.created).toBe(1);
    });

    it('propagates deletions during full sync for contacts that no longer exist in Google', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };
      storageStore.idMap = {
        'people/c1': 'local-c1',
        'people/c2_deleted': 'local-c2',
      };

      mockApi.addressBooks.list.mockResolvedValueOnce([
        { id: 'book-google', name: 'Google Contacts' },
      ]);
      mockApi.contacts.list.mockResolvedValueOnce([
        { id: 'local-c1', uid: 'urn:uuid:gcs-peoplec1' },
        { id: 'local-c2', uid: 'urn:uuid:gcs-peoplec2deleted' },
        { id: 'local-manual-user-contact', uid: 'urn:uuid:manual' }, // should NOT be deleted
      ]);

      // Google returns only c1
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [
            {
              resourceName: 'people/c1',
              names: [{ displayName: 'Alice' }],
            },
          ],
          nextSyncToken: 'sync-token-full',
        }),
      });

      const result = await sync(mockApi, 'client-id-1', { full: true });

      expect(result).toEqual({ created: 0, updated: 1, deleted: 1 });
      expect(mockApi.contacts.remove).toHaveBeenCalledWith('local-c2');
      expect(mockApi.contacts.remove).not.toHaveBeenCalledWith('local-manual-user-contact');
      expect(storageStore.idMap['people/c2_deleted']).toBeUndefined();
      expect(storageStore.idMap['people/c1']).toBe('local-c1');
    });

    it('retries with full sync when incremental sync returns SYNC_TOKEN_EXPIRED (410)', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };
      storageStore.syncToken = 'expired-token';

      mockApi.addressBooks.list.mockResolvedValue([{ id: 'book-google', name: 'Google Contacts' }]);
      mockApi.contacts.list.mockResolvedValue([]);

      // First call (incremental) returns 410, second call (full) returns 200
      mockApi.http.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 410,
          bodyText: 'Sync token expired',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Alice' }] }],
            nextSyncToken: 'fresh-sync-token',
          }),
        });

      mockApi.contacts.create.mockResolvedValueOnce({ id: 'local-alice' });

      const result = await sync(mockApi, 'client-id-1');

      expect(result.created).toBe(1);
      expect(storageStore.syncToken).toBe('fresh-sync-token');
      expect(mockApi.http.fetch).toHaveBeenCalledTimes(2);
    });

    it('re-fetches individual missing contact if local contact was deleted locally during incremental sync', async () => {
      storageStore['oauth.tokens'] = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 100_000,
      };
      storageStore.syncToken = 'valid-sync-token';
      storageStore.idMap = {
        'people/c1': 'local-c1',
        'people/c2': 'local-c2-deleted-locally',
      };

      mockApi.addressBooks.list.mockResolvedValue([{ id: 'book-google', name: 'Google Contacts' }]);
      mockApi.contacts.list.mockResolvedValue([
        { id: 'local-c1', uid: 'urn:uuid:gcs-peoplec1' }, // c2 missing locally
      ]);

      // fetchPerson for c2, then fetchConnections
      mockApi.http.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            resourceName: 'people/c2',
            names: [{ displayName: 'Bob' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            connections: [],
            nextSyncToken: 'new-token',
          }),
        });

      mockApi.contacts.create.mockResolvedValueOnce({ id: 'recreated-c2' });

      const result = await sync(mockApi, 'client-id-1');

      expect(result.created).toBe(1);
      expect(storageStore.idMap['people/c2']).toBe('recreated-c2');
    });
  });
});
