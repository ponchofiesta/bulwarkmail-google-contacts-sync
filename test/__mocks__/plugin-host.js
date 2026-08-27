// Mock for @plugin-host runtime injection
export const storageStore = {};

const pluginHostMock = {
  i18n: { locale: 'en' },
  plugin: {
    settings: {
      syncIntervalMinutes: 15,
      syncOnLogin: true,
      syncPeriodically: true,
      showToasts: true,
      addressBookName: 'Google Contacts',
    },
  },
  storage: {
    get: async (key) => storageStore[key] ?? null,
    set: async (key, val) => {
      storageStore[key] = val;
    },
    remove: async (key) => {
      delete storageStore[key];
    },
  },
  admin: {
    getConfig: async (key) => {
      if (key === 'clientId') return 'mock-client-id';
      if (key === 'clientSecret') return 'mock-client-secret';
      return null;
    },
  },
  addressBooks: {
    list: async () => [{ id: 'mock-book', name: 'Google Contacts' }],
    create: async (name) => ({ id: `book-${name}` }),
  },
  contacts: {
    list: async () => [],
    create: async (card) => ({ id: `contact-${card.uid}` }),
    update: async () => {},
    remove: async () => {},
  },
  ui: {
    openExternalUrl: async () => {},
    confirm: async () => true,
  },
  toast: {
    info: () => {},
    success: () => {},
    error: () => {},
  },
  log: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

export default pluginHostMock;
