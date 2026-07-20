// jsdom has no IndexedDB; this shims it so Dexie works in Vitest.
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
