import { describe, expect, it } from 'bun:test';
import { personToContactCard } from '../src/mapper';

describe('mapper - personToContactCard', () => {
  it('generates a valid individual ContactCard UID sanitized from resourceName', () => {
    const person = {
      resourceName: 'people/c1234567890:abc',
    };
    const card = personToContactCard(person);

    expect(card.kind).toBe('individual');
    expect(card.uid).toBe('urn:uuid:gcs-peoplec1234567890abc');
  });

  describe('name mapping', () => {
    it('maps given, middle, family, prefix, and suffix names to JSContact name components and full name', () => {
      const person = {
        resourceName: 'people/c1',
        names: [
          {
            metadata: { primary: true },
            displayName: 'Dr. Jane Mary Doe Jr.',
            honorificPrefix: 'Dr.',
            givenName: 'Jane',
            middleName: 'Mary',
            familyName: 'Doe',
            honorificSuffix: 'Jr.',
          },
        ],
      };
      const card = personToContactCard(person);

      expect(card.name).toEqual({
        isOrdered: true,
        full: 'Dr. Jane Mary Doe Jr.',
        components: [
          { kind: 'title', value: 'Dr.' },
          { kind: 'given', value: 'Jane' },
          { kind: 'given2', value: 'Mary' },
          { kind: 'surname', value: 'Doe' },
          { kind: 'generation', value: 'Jr.' },
        ],
      });
    });

    it('falls back to joining given and family names if displayName is missing', () => {
      const person = {
        resourceName: 'people/c1',
        names: [
          {
            givenName: 'John',
            familyName: 'Smith',
          },
        ],
      };
      const card = personToContactCard(person);

      expect(card.name?.full).toBe('John Smith');
    });

    it('selects the primary name entry over first entry if primary is specified later in the array', () => {
      const person = {
        resourceName: 'people/c1',
        names: [
          { displayName: 'Secondary Name', metadata: { primary: false } },
          { displayName: 'Primary Name', metadata: { primary: true } },
        ],
      };
      const card = personToContactCard(person);

      expect(card.name?.full).toBe('Primary Name');
    });

    it('returns null for name if names array is empty or not provided', () => {
      expect(personToContactCard({ resourceName: 'people/c1' }).name).toBeNull();
      expect(personToContactCard({ resourceName: 'people/c1', names: [] }).name).toBeNull();
    });
  });

  describe('email mapping', () => {
    it('maps email addresses and flags primary with pref: 1', () => {
      const person = {
        resourceName: 'people/c1',
        emailAddresses: [
          { value: 'primary@example.com', type: 'work', metadata: { primary: true } },
          { value: 'personal@example.com', type: 'home' },
          { value: '', type: 'other' }, // empty value should be skipped
        ],
      };
      const card = personToContactCard(person);

      expect(card.emails).toEqual({
        e1: { address: 'primary@example.com', label: 'work', pref: 1 },
        e2: { address: 'personal@example.com', label: 'home', pref: undefined },
      });
    });

    it('returns null if no valid emails exist', () => {
      expect(
        personToContactCard({ resourceName: 'people/c1', emailAddresses: [] }).emails
      ).toBeNull();
      expect(
        personToContactCard({ resourceName: 'people/c1', emailAddresses: [{ value: '' }] }).emails
      ).toBeNull();
    });
  });

  describe('phone mapping', () => {
    it('maps phone numbers preferring canonicalForm and sets fax feature when type is fax', () => {
      const person = {
        resourceName: 'people/c1',
        phoneNumbers: [
          { value: '(555) 123-4567', canonicalForm: '+15551234567', type: 'mobile' },
          { value: '555-9876', type: 'fax' },
        ],
      };
      const card = personToContactCard(person);

      expect(card.phones).toEqual({
        p1: { number: '+15551234567', label: 'mobile', features: undefined },
        p2: { number: '555-9876', label: 'fax', features: { fax: true } },
      });
    });

    it('returns null if phone numbers array is empty or has only empty values', () => {
      expect(
        personToContactCard({ resourceName: 'people/c1', phoneNumbers: [] }).phones
      ).toBeNull();
      expect(
        personToContactCard({ resourceName: 'people/c1', phoneNumbers: [{ value: '' }] }).phones
      ).toBeNull();
    });
  });

  describe('organization and title mapping', () => {
    it('maps organizations with departments and company names', () => {
      const person = {
        resourceName: 'people/c1',
        organizations: [
          { name: 'Acme Corp', department: 'Engineering', title: 'Lead Engineer' },
          { name: 'Consulting LLC' },
        ],
        occupations: [{ value: 'Architect' }],
      };
      const card = personToContactCard(person);

      expect(card.organizations).toEqual({
        o1: { name: 'Acme Corp', units: [{ name: 'Engineering' }] },
        o2: { name: 'Consulting LLC', units: undefined },
      });

      expect(card.titles).toEqual({
        t1: { name: 'Lead Engineer', kind: 'title' },
        t2: { name: 'Architect', kind: 'role' },
      });
    });

    it('returns null for organizations and titles if empty', () => {
      const person = { resourceName: 'people/c1', organizations: [], occupations: [] };
      const card = personToContactCard(person);
      expect(card.organizations).toBeNull();
      expect(card.titles).toBeNull();
    });
  });

  describe('address mapping', () => {
    it('maps structured postal addresses with components', () => {
      const person = {
        resourceName: 'people/c1',
        addresses: [
          {
            type: 'work',
            formattedValue: '123 Main St, Cityville, CA 90210, USA',
            streetAddress: '123 Main St',
            city: 'Cityville',
            region: 'CA',
            postalCode: '90210',
            country: 'USA',
          },
        ],
      };
      const card = personToContactCard(person);

      expect(card.addresses).toEqual({
        a1: {
          fullAddress: '123 Main St, Cityville, CA 90210, USA',
          label: 'work',
          street: '123 Main St',
          locality: 'Cityville',
          region: 'CA',
          postcode: '90210',
          country: 'USA',
          isOrdered: true,
          components: [
            { kind: 'name', value: '123 Main St' },
            { kind: 'locality', value: 'Cityville' },
            { kind: 'region', value: 'CA' },
            { kind: 'postcode', value: '90210' },
            { kind: 'country', value: 'USA' },
          ],
        },
      });
    });

    it('returns null if addresses array is empty', () => {
      expect(
        personToContactCard({ resourceName: 'people/c1', addresses: [] }).addresses
      ).toBeNull();
    });
  });

  describe('anniversaries / birthdays mapping', () => {
    it('maps full birthday with year, month, and day', () => {
      const person = {
        resourceName: 'people/c1',
        birthdays: [
          {
            metadata: { primary: true },
            date: { year: 1990, month: 5, day: 15 },
          },
        ],
      };
      const card = personToContactCard(person);

      expect(card.anniversaries).toEqual({
        b1: {
          kind: 'birth',
          date: { year: 1990, month: 5, day: 15 },
        },
      });
    });

    it('maps partial birthday with only month and day (no year)', () => {
      const person = {
        resourceName: 'people/c1',
        birthdays: [
          {
            date: { month: 12, day: 25 },
          },
        ],
      };
      const card = personToContactCard(person);

      expect(card.anniversaries).toEqual({
        b1: {
          kind: 'birth',
          date: { month: 12, day: 25 },
        },
      });
    });

    it('returns null if birthday is missing day or month', () => {
      const person = {
        resourceName: 'people/c1',
        birthdays: [{ date: { year: 1990, month: 5 } }],
      };
      expect(personToContactCard(person).anniversaries).toBeNull();
    });

    it('returns null if birthdays array is empty or omitted', () => {
      expect(personToContactCard({ resourceName: 'people/c1' }).anniversaries).toBeNull();
    });
  });

  describe('biographies / notes mapping', () => {
    it('maps primary biography note', () => {
      const person = {
        resourceName: 'people/c1',
        biographies: [
          { value: 'Secondary note', metadata: { primary: false } },
          { value: 'Primary note', metadata: { primary: true } },
        ],
      };
      const card = personToContactCard(person);
      expect(card.notes).toEqual({ n1: { note: 'Primary note' } });
    });

    it('returns null if no biography value exists', () => {
      expect(
        personToContactCard({ resourceName: 'people/c1', biographies: [{ value: '' }] }).notes
      ).toBeNull();
    });
  });

  describe('nicknames, urls, and photos mapping', () => {
    it('maps nicknames, urls, and photo media', () => {
      const person = {
        resourceName: 'people/c1',
        nicknames: [{ value: 'Johnny' }],
        urls: [
          { value: 'https://example.com', type: 'blog' },
          { value: '', type: 'empty' },
        ],
        photos: [{ url: 'https://lh3.googleusercontent.com/photo.jpg' }],
      };
      const card = personToContactCard(person);

      expect(card.nicknames).toEqual({ n1: { name: 'Johnny' } });
      expect(card.onlineServices).toEqual({ u1: { uri: 'https://example.com', label: 'blog' } });
      expect(card.media).toEqual({
        m1: { kind: 'photo', uri: 'https://lh3.googleusercontent.com/photo.jpg' },
      });
    });

    it('returns null if nickname, url or photo is missing or empty', () => {
      const person = {
        resourceName: 'people/c1',
        nicknames: [{ value: '' }],
        urls: [{ value: '' }],
        photos: [{ url: '' }],
      };
      const card = personToContactCard(person);

      expect(card.nicknames).toBeNull();
      expect(card.onlineServices).toBeNull();
      expect(card.media).toBeNull();
    });
  });
});
