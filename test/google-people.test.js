import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { fetchConnections, fetchPerson, PERSON_FIELDS } from '../src/google-people';

describe('google-people module', () => {
  let mockApi;

  beforeEach(() => {
    mockApi = {
      http: {
        fetch: vi.fn(),
      },
    };
  });

  describe('fetchConnections', () => {
    it('fetches single page of connections with nextSyncToken and auth header', async () => {
      const mockConnections = [
        { resourceName: 'people/c1', names: [{ displayName: 'Alice' }] },
        { resourceName: 'people/c2', names: [{ displayName: 'Bob' }] },
      ];

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: mockConnections,
          nextSyncToken: 'sync-token-xyz',
        }),
      });

      const res = await fetchConnections(mockApi, 'valid-access-token');

      expect(res).toEqual({
        people: mockConnections,
        nextSyncToken: 'sync-token-xyz',
      });

      expect(mockApi.http.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockApi.http.fetch.mock.calls[0];
      expect(url).toContain('https://people.googleapis.com/v1/people/me/connections');
      expect(url).toContain(`personFields=${encodeURIComponent(PERSON_FIELDS)}`);
      expect(url).toContain('pageSize=200');
      expect(url).toContain('requestSyncToken=true');
      expect(options.headers.Authorization).toBe('Bearer valid-access-token');
    });

    it('passes syncToken in request params when provided', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          connections: [],
          nextSyncToken: 'new-sync-token',
        }),
      });

      await fetchConnections(mockApi, 'token', 'existing-sync-token');
      const [url] = mockApi.http.fetch.mock.calls[0];
      expect(url).toContain('syncToken=existing-sync-token');
    });

    it('follows pagination when nextPageToken is returned', async () => {
      mockApi.http.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            connections: [{ resourceName: 'people/c1' }],
            nextPageToken: 'page-2-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          bodyText: JSON.stringify({
            connections: [{ resourceName: 'people/c2' }],
            nextSyncToken: 'final-sync-token',
          }),
        });

      const res = await fetchConnections(mockApi, 'token');

      expect(res.people).toHaveLength(2);
      expect(res.people[0].resourceName).toBe('people/c1');
      expect(res.people[1].resourceName).toBe('people/c2');
      expect(res.nextSyncToken).toBe('final-sync-token');
      expect(mockApi.http.fetch).toHaveBeenCalledTimes(2);

      const [url2] = mockApi.http.fetch.mock.calls[1];
      expect(url2).toContain('pageToken=page-2-token');
    });

    it('throws SYNC_TOKEN_EXPIRED error when Google returns 410', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        bodyText: 'Sync token expired',
      });

      await expect(fetchConnections(mockApi, 'token', 'expired-token')).rejects.toMatchObject({
        message: 'SYNC_TOKEN_EXPIRED',
        code: 'SYNC_TOKEN_EXPIRED',
      });
    });

    it('throws UNAUTHORIZED error when Google returns 401', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        bodyText: 'Invalid credentials',
      });

      await expect(fetchConnections(mockApi, 'bad-token')).rejects.toMatchObject({
        message: 'UNAUTHORIZED',
        code: 'UNAUTHORIZED',
      });
    });

    it('throws generic error when Google returns non-ok status code', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        bodyText: 'Internal server error from google',
      });

      await expect(fetchConnections(mockApi, 'token')).rejects.toThrow(
        /People API request failed \(500\)/
      );
    });
  });

  describe('fetchPerson', () => {
    it('fetches a single person by resourceName', async () => {
      const mockPerson = {
        resourceName: 'people/c123',
        names: [{ displayName: 'John Doe' }],
      };

      mockApi.http.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify(mockPerson),
      });

      const res = await fetchPerson(mockApi, 'token', 'people/c123');
      expect(res).toEqual(mockPerson);

      const [url, options] = mockApi.http.fetch.mock.calls[0];
      expect(url).toBe(
        `https://people.googleapis.com/v1/people/c123?personFields=${encodeURIComponent(PERSON_FIELDS)}`
      );
      expect(options.headers.Authorization).toBe('Bearer token');
    });

    it('returns null when person is not found (404)', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        bodyText: 'Not found',
      });

      const res = await fetchPerson(mockApi, 'token', 'people/c_deleted');
      expect(res).toBeNull();
    });

    it('throws UNAUTHORIZED when status is 401', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        bodyText: 'Unauthorized',
      });

      await expect(fetchPerson(mockApi, 'bad-token', 'people/c123')).rejects.toMatchObject({
        message: 'UNAUTHORIZED',
        code: 'UNAUTHORIZED',
      });
    });

    it('throws error on other HTTP failure statuses', async () => {
      mockApi.http.fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        bodyText: 'Service Unavailable',
      });

      await expect(fetchPerson(mockApi, 'token', 'people/c123')).rejects.toThrow(
        /People API request failed \(503\)/
      );
    });
  });
});
