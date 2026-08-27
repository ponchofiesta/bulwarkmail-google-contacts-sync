// Sync engine for the Google Contacts Sync plugin.
//
// One-way: Google → Bulwark. Contacts land in a dedicated "Google Contacts"
// address book (find-or-create). Deletions in Google propagate on full
// resyncs (syncToken expiry or manual trigger) — the People API's
// incremental connections response does not enumerate deletions.

import { fetchConnections, fetchPerson } from './google-people';
import { personToContactCard } from './mapper';
import * as oauth from './oauth';

const ADDRESS_BOOK_NAME = 'Google Contacts';

/**
 * Find or create the dedicated sync address book. Returns the book id.
 */
async function ensureAddressBook(api) {
  const name = (api.plugin?.settings?.addressBookName || '').trim() || ADDRESS_BOOK_NAME;
  const books = await api.addressBooks.list();
  const existing = (books || []).find((b) => b.name === name);
  if (existing) return existing.id;
  const created = await api.addressBooks.create(name);
  return created.id;
}

/**
 * Create the contact in the sync address book and return its local id.
 * If creation fails due to an existing contact with the same UID, resolves
 * or extracts the existing contact ID and updates it instead.
 */
async function upsertContact(api, bookId, card, existingContactsByUid = null) {
  // Check if we already have a cached/listed contact with this UID
  if (existingContactsByUid && card.uid && existingContactsByUid.has(card.uid)) {
    const existing = existingContactsByUid.get(card.uid);
    await api.contacts.update(existing.id, card);
    return existing.id;
  }

  try {
    const created = await api.contacts.create({ ...card, addressBookIds: { [bookId]: true } });
    return created && typeof created === 'object' ? created.id : created;
  } catch (err) {
    const errMsg = (err && (err.message || err.description || String(err))) || '';
    // Check if error is a UID conflict (e.g., "Contact with UID ... already exists with id b.")
    const match = errMsg.match(/already exists with id ([^.\s]+)/i);
    if (match?.[1]) {
      const existingId = match[1];
      await api.contacts.update(existingId, card);
      return existingId;
    }

    // If no ID in error message, attempt to look up existing contacts in the address book
    const localContacts = await api.contacts.list(bookId);
    const found = (localContacts || []).find((c) => c.uid && c.uid === card.uid);
    if (found) {
      await api.contacts.update(found.id, card);
      return found.id;
    }

    throw err;
  }
}

/**
 * Run one sync pass.
 *
 * @param {object} api            plugin host API
 * @param {string} clientId       Google OAuth client id
 * @param {object} opts           { full: boolean } — force a full resync
 * @returns {Promise<{created:number, updated:number, deleted:number}>}
 */
async function sync(api, clientId, opts = {}) {
  const forceFull = opts.full === true;
  const storedSyncToken = forceFull ? null : await api.storage.get('syncToken');
  const idMap = (await api.storage.get('idMap')) || {};

  const accessToken = await oauth.getAccessToken(api, clientId, opts.clientSecret);
  const bookId = await ensureAddressBook(api);

  // Fetch local contacts in the sync address book
  let localContacts = null;
  const existingContactsByUid = new Map();
  const localContactIds = new Set();
  try {
    localContacts = await api.contacts.list(bookId);
    for (const contact of localContacts || []) {
      if (contact) {
        if (contact.id) localContactIds.add(contact.id);
        if (contact.uid) existingContactsByUid.set(contact.uid, contact);
      }
    }
  } catch {
    // Ignore list failures
  }

  // Find idMap entries that point to local contacts that were deleted locally
  const missingResourceNames = [];
  for (const [resourceName, localId] of Object.entries(idMap)) {
    if (localId && !localContactIds.has(localId)) {
      missingResourceNames.push(resourceName);
      delete idMap[resourceName];
    }
  }

  let created = 0,
    updated = 0,
    deleted = 0;

  // If local contacts were deleted locally and we are doing an incremental sync,
  // directly fetch and recreate only the missing contacts from Google.
  // This preserves the incremental syncToken and avoids re-updating all unchanged contacts.
  if (missingResourceNames.length > 0 && storedSyncToken) {
    for (const rn of missingResourceNames) {
      try {
        const person = await fetchPerson(api, accessToken, rn);
        if (person?.resourceName) {
          const card = personToContactCard(person);
          const newLocalId = await upsertContact(api, bookId, card, existingContactsByUid);
          idMap[person.resourceName] = newLocalId;
          created++;
        }
      } catch (err) {
        api.log?.warn?.(`Failed to fetch missing contact ${rn}:`, err.message);
      }
    }
  }

  let people, nextSyncToken;
  try {
    ({ people, nextSyncToken } = await fetchConnections(api, accessToken, storedSyncToken));
  } catch (err) {
    if (err.code === 'SYNC_TOKEN_EXPIRED') {
      // Token expired — retry as a full sync (which also re-runs deletion diff)
      await api.storage.remove('syncToken');
      return sync(api, clientId, { full: true, clientSecret: opts.clientSecret });
    }
    throw err;
  }

  const isFullSync = !storedSyncToken;

  // ── Upsert every person Google returned ──
  const seenResourceNames = new Set();
  for (const person of people) {
    if (!person.resourceName) continue;
    seenResourceNames.add(person.resourceName);

    const card = personToContactCard(person);
    const localId = idMap[person.resourceName];

    if (localId) {
      try {
        await api.contacts.update(localId, card);
        updated++;
      } catch {
        // Update failed — the local contact may have been modified/deleted manually.
        // Fall back to upsertContact.
        const newLocalId = await upsertContact(api, bookId, card, existingContactsByUid);
        idMap[person.resourceName] = newLocalId;
        created++;
      }
    } else {
      const newLocalId = await upsertContact(api, bookId, card, existingContactsByUid);
      idMap[person.resourceName] = newLocalId;
      created++;
    }
  }

  // ── Deletion propagation (full syncs only) ──
  if (isFullSync) {
    if (!localContacts) {
      try {
        localContacts = await api.contacts.list(bookId);
      } catch {
        localContacts = [];
      }
    }
    for (const contact of localContacts || []) {
      // Find which resourceName maps to this local contact, if any.
      let resourceName = null;
      for (const [rn, lid] of Object.entries(idMap)) {
        if (lid === contact.id) {
          resourceName = rn;
          break;
        }
      }
      // Only delete contacts we previously synced (resourceName known) that
      // Google no longer returns. Never touch contacts the user added to the
      // book manually (no resourceName mapping).
      if (resourceName && !seenResourceNames.has(resourceName)) {
        try {
          await api.contacts.remove(contact.id);
          delete idMap[resourceName];
          deleted++;
        } catch {
          // Ignore individual delete failures; next full sync retries.
        }
      }
    }
    // Drop idMap entries for resource names Google no longer knows about.
    for (const rn of Object.keys(idMap)) {
      if (!seenResourceNames.has(rn)) delete idMap[rn];
    }
  }

  if (nextSyncToken) await api.storage.set('syncToken', nextSyncToken);
  await api.storage.set('idMap', idMap);
  await api.storage.set('lastSyncAt', Date.now());

  return { created, updated, deleted };
}

/**
 * Whether a sync should run now given the configured minimum interval.
 */
async function shouldAutoSync(api, intervalMinutes) {
  const last = await api.storage.get('lastSyncAt');
  if (!last) return true;
  return Date.now() - last >= intervalMinutes * 60_000;
}

export { ADDRESS_BOOK_NAME, ensureAddressBook, shouldAutoSync, sync };
