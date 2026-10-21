import { cleanText } from './text';
import type { CallRecord, Chunk, InboxItem, NewRecord, RecordPatch } from './types';

export const DB_NAME = 'call-search';
const DB_VERSION = 1;

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openDatabase(factory: IDBFactory, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('records', { keyPath: 'id' }).createIndex('date', 'date');
        db.createObjectStore('inbox', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: 'id' }).createIndex('recordId', 'recordId');
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another open tab'));
  });
}

type StoreName = 'records' | 'inbox' | 'chunks' | 'kv';

export class Store {
  constructor(
    readonly db: IDBDatabase,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME, newId?: () => string): Promise<Store> {
    return new Store(await openDatabase(factory, name), newId);
  }

  close(): void {
    this.db.close();
  }

  private read<T>(store: StoreName, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return request(op(this.db.transaction(store).objectStore(store)));
  }

  private async write<T>(stores: StoreName[], body: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const tx = this.db.transaction(stores, 'readwrite');
    const done = finished(tx);
    try {
      const value = await body(tx);
      await done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async listRecords(): Promise<CallRecord[]> {
    const all = await this.read('records', (s) => s.getAll() as IDBRequest<CallRecord[]>);
    return all.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
  }

  getRecord(id: string): Promise<CallRecord | undefined> {
    return this.read('records', (s) => s.get(id) as IDBRequest<CallRecord | undefined>);
  }

  countRecords(): Promise<number> {
    return this.read('records', (s) => s.count());
  }

  async addRecord(input: NewRecord, now = Date.now()): Promise<CallRecord> {
    if (!Number.isFinite(input.date)) throw new Error('date must be a finite timestamp');
    const { id, ...rest } = input;
    const record: CallRecord = {
      ...rest,
      id: id ?? this.newId(),
      contact: input.contact.normalize('NFC').trim(),
      number: input.number.trim(),
      text: cleanText(input.text),
      createdAt: now,
      updatedAt: now,
    };
    await this.write(['records'], (tx) => {
      tx.objectStore('records').add(record);
    });
    return record;
  }

  updateRecord(id: string, patch: RecordPatch, now = Date.now()): Promise<CallRecord> {
    return this.write(['records'], async (tx) => {
      const store = tx.objectStore('records');
      const current = await request(store.get(id) as IDBRequest<CallRecord | undefined>);
      if (!current) throw new Error(`record ${id} not found`);
      const next: CallRecord = { ...current, ...patch, updatedAt: now };
      if (patch.contact !== undefined) next.contact = patch.contact.normalize('NFC').trim();
      if (patch.number !== undefined) next.number = patch.number.trim();
      if (patch.text !== undefined) next.text = cleanText(patch.text);
      if (!Number.isFinite(next.date)) throw new Error('date must be a finite timestamp');
      store.put(next);
      return next;
    });
  }

  putRecords(records: CallRecord[]): Promise<void> {
    return this.write(['records'], (tx) => {
      const store = tx.objectStore('records');
      for (const record of records) store.put(record);
    });
  }

  deleteRecord(id: string): Promise<void> {
    return this.write(['records', 'chunks'], async (tx) => {
      tx.objectStore('records').delete(id);
      const chunks = tx.objectStore('chunks');
      const keys = await request(chunks.index('recordId').getAllKeys(id));
      for (const key of keys) chunks.delete(key);
    });
  }

  clearAll(): Promise<void> {
    return this.write(['records', 'chunks', 'inbox'], (tx) => {
      tx.objectStore('records').clear();
      tx.objectStore('chunks').clear();
      tx.objectStore('inbox').clear();
    });
  }

  async addInbox(item: Omit<InboxItem, 'id' | 'receivedAt'>, now = Date.now()): Promise<InboxItem> {
    const full: InboxItem = { ...item, id: this.newId(), receivedAt: now };
    await this.write(['inbox'], (tx) => {
      tx.objectStore('inbox').add(full);
    });
    return full;
  }

  async listInbox(): Promise<InboxItem[]> {
    const all = await this.read('inbox', (s) => s.getAll() as IDBRequest<InboxItem[]>);
    return all.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  deleteInbox(id: string): Promise<void> {
    return this.write(['inbox'], (tx) => {
      tx.objectStore('inbox').delete(id);
    });
  }

  replaceChunks(recordId: string, chunks: Chunk[]): Promise<void> {
    return this.write(['chunks'], async (tx) => {
      const store = tx.objectStore('chunks');
      const keys = await request(store.index('recordId').getAllKeys(recordId));
      for (const key of keys) store.delete(key);
      for (const chunk of chunks) store.put(chunk);
    });
  }

  listChunks(): Promise<Chunk[]> {
    return this.read('chunks', (s) => s.getAll() as IDBRequest<Chunk[]>);
  }

  getSetting<T>(key: string): Promise<T | undefined> {
    return this.read('kv', (s) => s.get(key) as IDBRequest<T | undefined>);
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.write(['kv'], (tx) => {
      tx.objectStore('kv').put(value, key);
    });
  }
}
