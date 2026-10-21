import { describe, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../src/core/store';
import type { Chunk, NewRecord } from '../src/core/types';

let dbCount = 0;
function openStore(): Promise<Store> {
  let next = 0;
  return Store.open(new IDBFactory(), `test-${dbCount++}`, () => `id${++next}`);
}

const draft = (text: string, date: number, contact = ''): NewRecord => ({
  source: 'text',
  contact,
  number: '',
  date,
  dateSource: 'manual',
  text,
});

const chunk = (recordId: string, index: number): Chunk => ({
  id: `${recordId}:${index}`,
  recordId,
  index,
  start: 0,
  end: 2,
  text: '내용',
  model: 'fake',
  vector: new Float32Array([index, 1, 2]),
});

describe('Store records', () => {
  test('add normalizes text and lists newest first', async () => {
    const store = await openStore();
    const a = await store.addRecord(draft('  첫 통화\r\n둘째 줄  ', 1000, ' 김과장 '), 5);
    await store.addRecord(draft('나중 통화', 3000), 6);
    await store.addRecord(draft('중간 통화', 2000), 7);
    expect(a).toMatchObject({ id: 'id1', text: '첫 통화\n둘째 줄', contact: '김과장', createdAt: 5, updatedAt: 5 });
    expect((await store.listRecords()).map((r) => r.text)).toEqual(['나중 통화', '중간 통화', '첫 통화\n둘째 줄']);
    expect(await store.countRecords()).toBe(3);
  });

  test('add stores NFC text', async () => {
    const store = await openStore();
    const r = await store.addRecord(draft('홍길동'.normalize('NFD'), 1));
    expect((await store.getRecord(r.id))!.text).toBe('홍길동');
  });

  test('add rejects a non-finite date', async () => {
    const store = await openStore();
    await expect(store.addRecord(draft('x', Number.NaN))).rejects.toThrow('finite');
  });

  test('update patches fields and bumps updatedAt', async () => {
    const store = await openStore();
    const r = await store.addRecord(draft('본문', 1000), 1);
    const u = await store.updateRecord(r.id, { contact: '이대리', number: '01012345678', date: 2000, dateSource: 'manual' }, 9);
    expect(u).toMatchObject({ contact: '이대리', number: '01012345678', date: 2000, text: '본문', createdAt: 1, updatedAt: 9 });
    expect(await store.getRecord(r.id)).toEqual(u);
  });

  test('editing the text drops the now-stale timed segments', async () => {
    const store = await openStore();
    const r = await store.addRecord({ ...draft('원래 문장', 1000), source: 'audio', segments: [{ start: 0, end: 1, text: '원래 문장' }] });
    expect((await store.updateRecord(r.id, { text: '원래 문장' })).segments).toHaveLength(1);
    expect((await store.updateRecord(r.id, { text: '고친 문장' })).segments).toBeUndefined();
  });

  test('update of a missing record fails and changes nothing', async () => {
    const store = await openStore();
    await expect(store.updateRecord('nope', { contact: 'x' })).rejects.toThrow('not found');
    expect(await store.countRecords()).toBe(0);
  });

  test('delete removes the record and its chunks only', async () => {
    const store = await openStore();
    const a = await store.addRecord(draft('a', 1));
    const b = await store.addRecord(draft('b', 2));
    await store.replaceChunks(a.id, [chunk(a.id, 0), chunk(a.id, 1)]);
    await store.replaceChunks(b.id, [chunk(b.id, 0)]);
    await store.deleteRecord(a.id);
    expect((await store.listRecords()).map((r) => r.id)).toEqual([b.id]);
    expect((await store.listChunks()).map((c) => c.id)).toEqual([`${b.id}:0`]);
  });

  test('putRecords upserts whole records', async () => {
    const store = await openStore();
    const a = await store.addRecord(draft('a', 1));
    await store.putRecords([{ ...a, text: 'changed' }, { ...a, id: 'other', text: 'new' }]);
    expect((await store.listRecords()).map((r) => [r.id, r.text])).toEqual([
      ['id1', 'changed'],
      ['other', 'new'],
    ]);
  });

  test('clearAll empties records, chunks and inbox but keeps settings', async () => {
    const store = await openStore();
    const a = await store.addRecord(draft('a', 1));
    await store.replaceChunks(a.id, [chunk(a.id, 0)]);
    await store.addInbox({ kind: 'text', name: 'shared.txt', type: 'text/plain', lastModified: 0, text: '공유' });
    await store.setSetting('asrModel', 'sensevoice');
    await store.clearAll();
    expect(await store.listRecords()).toEqual([]);
    expect(await store.listChunks()).toEqual([]);
    expect(await store.listInbox()).toEqual([]);
    expect(await store.getSetting<string>('asrModel')).toBe('sensevoice');
  });
});

describe('Store chunks', () => {
  test('replaceChunks swaps the set for one record and keeps vectors', async () => {
    const store = await openStore();
    await store.replaceChunks('r1', [chunk('r1', 0), chunk('r1', 1), chunk('r1', 2)]);
    await store.replaceChunks('r1', [chunk('r1', 0)]);
    const chunks = await store.listChunks();
    expect(chunks.map((c) => c.id)).toEqual(['r1:0']);
    expect(Array.from(chunks[0]!.vector)).toEqual([0, 1, 2]);
  });
});

describe('Store inbox and settings', () => {
  test('inbox items come back oldest first and can be deleted', async () => {
    const store = await openStore();
    const first = await store.addInbox({ kind: 'text', name: 'a', type: 'text/plain', lastModified: 0, text: '하나' }, 20);
    await store.addInbox({ kind: 'text', name: 'b', type: 'text/plain', lastModified: 0, text: '둘' }, 10);
    expect((await store.listInbox()).map((i) => i.text)).toEqual(['둘', '하나']);
    await store.deleteInbox(first.id);
    expect((await store.listInbox()).map((i) => i.text)).toEqual(['둘']);
  });

  test('settings round-trip and default to undefined', async () => {
    const store = await openStore();
    expect(await store.getSetting('missing')).toBeUndefined();
    await store.setSetting('llm', { id: 'qwen', ok: true });
    expect(await store.getSetting('llm')).toEqual({ id: 'qwen', ok: true });
  });
});
