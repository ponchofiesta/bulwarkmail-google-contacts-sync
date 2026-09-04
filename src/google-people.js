// Google People API client for the Google Contacts Sync plugin.
//
// Fetches `people/me/connections` with incremental syncToken support,
// through the host's sandboxed HTTP proxy (api.http.fetch).

const CONNECTIONS_ENDPOINT = 'https://people.googleapis.com/v1/people/me/connections';

const PERSON_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'organizations',
  'biographies',
  'addresses',
  'birthdays',
  'photos',
  'nicknames',
  'occupations',
  'urls',
].join(',');

/**
 * Fetch all connections. When `syncToken` is provided, requests an
 * incremental delta; Google returns HTTP 410 when the token has expired,
 * in which case the caller should retry with a full sync.
 *
 * Returns { people, nextSyncToken }.
 */
async function fetchConnections(api, accessToken, syncToken) {
  const people = [];
  let pageToken = null;
  let nextSyncToken = null;

  do {
    const params = new URLSearchParams({
      personFields: PERSON_FIELDS,
      pageSize: '200',
      requestSyncToken: 'true',
    });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);

    const res = await api.http.fetch(`${CONNECTIONS_ENDPOINT}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401) {
      const err = new Error('UNAUTHORIZED');
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    if (!res.ok) {
      // syncToken expired: Google signals this with HTTP 410 (Gone) or HTTP 400
      // with status FAILED_PRECONDITION ("Sync token is expired...").
      // Either way the caller must do a full resync without the syncToken.
      const detail = res.bodyText ? res.bodyText.slice(0, 200) : '';
      if (
        res.status === 410 ||
        (res.status === 400 && /Sync token is expired/i.test(res.bodyText || ''))
      ) {
        const err = new Error('SYNC_TOKEN_EXPIRED');
        err.code = 'SYNC_TOKEN_EXPIRED';
        throw err;
      }
      throw new Error(`People API request failed (${res.status}) ${detail}`);
    }

    const data = JSON.parse(res.bodyText);
    if (Array.isArray(data.connections)) people.push(...data.connections);
    pageToken = data.nextPageToken || null;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { people, nextSyncToken };
}

/**
 * Fetch a single person by resourceName (e.g. 'people/c12345').
 */
async function fetchPerson(api, accessToken, resourceName) {
  const params = new URLSearchParams({
    personFields: PERSON_FIELDS,
  });
  const res = await api.http.fetch(`https://people.googleapis.com/v1/${resourceName}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) {
    return null;
  }
  if (res.status === 401) {
    const err = new Error('UNAUTHORIZED');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (!res.ok) {
    const detail = res.bodyText ? res.bodyText.slice(0, 200) : '';
    throw new Error(`People API request failed (${res.status}) ${detail}`);
  }

  return JSON.parse(res.bodyText);
}

export { fetchConnections, fetchPerson, PERSON_FIELDS };
