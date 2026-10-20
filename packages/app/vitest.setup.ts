/**
 * #2126 — every test starts with empty `localStorage` and `sessionStorage`.
 *
 * Which storage a jsdom test gets depends on the Node version. On Node 25,
 * Node's own `localStorage` wins, and its methods do nothing without
 * `--localstorage-file`; on Node 22 it's jsdom's, which works and keeps what
 * one test saved for the next. So the same suite passed on 25 and failed 36
 * tests on 22, all of them reading a camera, a row height or an expanded lane
 * an earlier test had saved.
 *
 * A fresh in-memory storage per test makes both versions behave the same, and
 * makes each test's storage its own. A test that installs its own storage (to
 * spy on it, or to make it throw) still can: it replaces this one for itself.
 */
import { beforeEach } from 'vitest'

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length(): number {
    return this.items.size
  }
  clear(): void {
    this.items.clear()
  }
  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.items.delete(String(key))
  }
  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value))
  }
}

beforeEach(() => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const storage = new MemoryStorage()
    // Defined on both: code reads `localStorage` bare as well as through `window`.
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: storage })
    if (typeof window !== 'undefined' && window !== globalThis) {
      Object.defineProperty(window, name, { configurable: true, writable: true, value: storage })
    }
  }
})
