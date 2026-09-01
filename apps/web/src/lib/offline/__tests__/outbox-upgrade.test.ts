import { afterEach, describe, expect, it } from "vitest";
import type { OutboxEntry } from "../outbox-core";

type RequestHandler = (event: Event) => void;

class FixtureRequest<T> {
  result: T;
  error: Error | null = null;
  onupgradeneeded: RequestHandler | null = null;
  onsuccess: RequestHandler | null = null;
  onerror: RequestHandler | null = null;

  constructor(result: T) {
    this.result = result;
  }
}

class FixtureStoreNames {
  constructor(private readonly names: string[]) {}

  contains(name: string): boolean {
    return this.names.includes(name);
  }

  add(name: string): void {
    if (!this.names.includes(name)) this.names.push(name);
  }
}

class FixtureObjectStore {
  constructor(private readonly rows: OutboxEntry[]) {}

  getAll(): FixtureRequest<OutboxEntry[]> {
    const request = new FixtureRequest([...this.rows]);
    queueMicrotask(() => request.onsuccess?.(new Event("success")));
    return request;
  }

  createIndex(): void {
    // The upgrade handler only needs to be able to create indexes on a new store.
  }
}

class FixtureDatabase {
  readonly objectStoreNames: FixtureStoreNames;
  private readonly store: FixtureObjectStore;

  constructor(rows: OutboxEntry[]) {
    this.objectStoreNames = new FixtureStoreNames(["outbox"]);
    this.store = new FixtureObjectStore(rows);
  }

  transaction(): { objectStore: () => FixtureObjectStore } {
    return { objectStore: () => this.store };
  }

  createObjectStore(): FixtureObjectStore {
    this.objectStoreNames.add("outbox");
    return this.store;
  }

  close(): void {}
}

class IndexedDbUpgradeFixture {
  readonly database: FixtureDatabase;
  upgraded = false;

  constructor(rows: OutboxEntry[]) {
    this.database = new FixtureDatabase(rows);
  }

  open(): FixtureRequest<FixtureDatabase> {
    const request = new FixtureRequest(this.database);
    queueMicrotask(() => {
      this.upgraded = true;
      request.onupgradeneeded?.(new Event("upgradeneeded"));
      request.onsuccess?.(new Event("success"));
    });
    return request;
  }
}

describe("offline outbox upgrade compatibility", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
    originalDescriptor = undefined;
  });

  it("keeps a legacy completion row when an existing outbox is upgraded", async () => {
    const legacyEntry: OutboxEntry = {
      id: "complete-1700000000000",
      op: "complete",
      sessionId: "00000000-0000-4000-8000-000000000001",
      seq: 1,
      payload: {
        sessionId: "00000000-0000-4000-8000-000000000001",
      },
      createdAt: 1,
      attempts: 0,
    };
    const fixture = new IndexedDbUpgradeFixture([legacyEntry]);
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fixture,
    });

    const { listPending } = await import("../outbox");
    await expect(listPending()).resolves.toEqual([legacyEntry]);
    expect(fixture.upgraded).toBe(true);
    expect(fixture.database.objectStoreNames.contains("outbox")).toBe(true);
  });
});
