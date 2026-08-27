// Maps Google People API `person` objects to JSContact `ContactCard` shapes
// (RFC 9553 / RFC 9610, as consumed by Bulwark's JMAP client).
//
// The mapping is intentionally lossy in places: Google's model is richer than
// what we sync. Everything we do map round-trips through the plugin's
// resourceName → local id map, so re-syncs update in place.

function primary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.find((i) => i.metadata?.primary) || items[0];
}

function mapName(person) {
  const name = primary(person.names);
  if (!name) return null;
  const components = [];
  if (name.honorificPrefix) components.push({ kind: 'title', value: name.honorificPrefix });
  if (name.givenName) components.push({ kind: 'given', value: name.givenName });
  if (name.middleName) components.push({ kind: 'given2', value: name.middleName });
  if (name.familyName) components.push({ kind: 'surname', value: name.familyName });
  if (name.honorificSuffix) components.push({ kind: 'generation', value: name.honorificSuffix });
  return {
    isOrdered: true,
    full: name.displayName || [name.givenName, name.familyName].filter(Boolean).join(' ') || null,
    components,
  };
}

function mapEmails(person) {
  if (!Array.isArray(person.emailAddresses) || person.emailAddresses.length === 0) return null;
  const emails = {};
  person.emailAddresses.forEach((e, i) => {
    if (!e.value) return;
    emails[`e${i + 1}`] = {
      address: e.value,
      label: e.type || undefined,
      pref: e.metadata?.primary ? 1 : undefined,
    };
  });
  return Object.keys(emails).length ? emails : null;
}

function mapPhones(person) {
  if (!Array.isArray(person.phoneNumbers) || person.phoneNumbers.length === 0) return null;
  const phones = {};
  person.phoneNumbers.forEach((p, i) => {
    if (!p.value && !p.canonicalForm) return;
    phones[`p${i + 1}`] = {
      number: p.canonicalForm || p.value,
      label: p.type || undefined,
      features: p.type === 'fax' ? { fax: true } : undefined,
    };
  });
  return Object.keys(phones).length ? phones : null;
}

function mapOrganizations(person) {
  if (!Array.isArray(person.organizations) || person.organizations.length === 0) return null;
  const orgs = {};
  person.organizations.forEach((o, i) => {
    if (!o.name && !o.department) return;
    orgs[`o${i + 1}`] = {
      name: o.name || undefined,
      units: o.department ? [{ name: o.department }] : undefined,
    };
  });
  return Object.keys(orgs).length ? orgs : null;
}

function mapTitles(person) {
  const titles = {};
  let idx = 1;
  if (Array.isArray(person.organizations)) {
    person.organizations.forEach((o) => {
      if (o.title) {
        titles[`t${idx++}`] = { name: o.title, kind: 'title' };
      }
    });
  }
  if (Array.isArray(person.occupations)) {
    person.occupations.forEach((occ) => {
      if (occ.value) {
        titles[`t${idx++}`] = { name: occ.value, kind: 'role' };
      }
    });
  }
  return Object.keys(titles).length ? titles : null;
}

function mapNotes(person) {
  if (!Array.isArray(person.biographies) || person.biographies.length === 0) return null;
  const bio = primary(person.biographies);
  if (!bio?.value) return null;
  return { n1: { note: bio.value } };
}

function mapAddresses(person) {
  if (!Array.isArray(person.addresses) || person.addresses.length === 0) return null;
  const addresses = {};
  person.addresses.forEach((a, i) => {
    const components = [];
    if (a.streetAddress) components.push({ kind: 'name', value: a.streetAddress });
    if (a.city) components.push({ kind: 'locality', value: a.city });
    if (a.region) components.push({ kind: 'region', value: a.region });
    if (a.postalCode) components.push({ kind: 'postcode', value: a.postalCode });
    if (a.country) components.push({ kind: 'country', value: a.country });

    addresses[`a${i + 1}`] = {
      fullAddress: a.formattedValue || undefined,
      label: a.type || undefined,
      street: a.streetAddress || undefined,
      locality: a.city || undefined,
      region: a.region || undefined,
      postcode: a.postalCode || undefined,
      country: a.country || undefined,
      components: components.length ? components : undefined,
      isOrdered: components.length ? true : undefined,
    };
  });
  return Object.keys(addresses).length ? addresses : null;
}

function mapAnniversaries(person) {
  if (!Array.isArray(person.birthdays) || person.birthdays.length === 0) return null;
  const b = primary(person.birthdays);
  if (!b?.date) return null;
  const { year, month, day } = b.date;
  if (!month || !day) return null; // partial dates don't map cleanly
  const partialDate = {
    month,
    day,
  };
  if (year) partialDate.year = year;
  return { b1: { kind: 'birth', date: partialDate } };
}

function mapNicknames(person) {
  if (!Array.isArray(person.nicknames) || person.nicknames.length === 0) return null;
  const nick = primary(person.nicknames);
  if (!nick?.value) return null;
  return { n1: { name: nick.value } };
}

function mapOnlineServices(person) {
  if (!Array.isArray(person.urls) || person.urls.length === 0) return null;
  const services = {};
  person.urls.forEach((u, i) => {
    if (!u.value) return;
    services[`u${i + 1}`] = { uri: u.value, label: u.type || undefined };
  });
  return Object.keys(services).length ? services : null;
}

function mapPhotos(person) {
  if (!Array.isArray(person.photos) || person.photos.length === 0) return null;
  const photo = primary(person.photos);
  if (!photo?.url) return null;
  return { m1: { kind: 'photo', uri: photo.url } };
}

/**
 * Convert a Google `person` to a partial ContactCard (no id / addressBookIds —
 * the sync engine fills those in).
 */
function personToContactCard(person) {
  const card = {
    kind: 'individual',
    uid: `urn:uuid:gcs-${person.resourceName.replace(/[^a-zA-Z0-9]/g, '')}`,
    name: mapName(person),
    emails: mapEmails(person),
    phones: mapPhones(person),
    organizations: mapOrganizations(person),
    titles: mapTitles(person),
    notes: mapNotes(person),
    addresses: mapAddresses(person),
    anniversaries: mapAnniversaries(person),
    nicknames: mapNicknames(person),
    onlineServices: mapOnlineServices(person),
    media: mapPhotos(person),
  };

  return card;
}

export { personToContactCard };
