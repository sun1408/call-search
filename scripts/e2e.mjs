// End-to-end checks in headless Chromium against the built site (docs/) or a live URL.
// Usage: node scripts/e2e.mjs --suite core [--base https://sun1408.github.io/call-search/] [--out <dir>]
// Chromium: $CHROME_PATH, else the newest Playwright Chromium in ~/.cache/ms-playwright.
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SUITES = arg('suite', 'core').split(',');
const OUT = arg('out', await mkdtemp(join(tmpdir(), 'cs-e2e-out-')));
await mkdir(OUT, { recursive: true });
const t0 = Date.now();
const lines = [];
const results = {};

function step(message) {
  const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`;
  console.log(line);
  lines.push(line);
}

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  step(`PASS ${message}`);
}

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const dirs = (await readdir(cache)).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const p = join(cache, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no Chromium found; set CHROME_PATH');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

function serveDocs() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/call-search/')) return res.writeHead(404).end();
    let rel = decodeURIComponent(url.pathname.slice('/call-search/'.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (rel.split('/').includes('..')) return res.writeHead(400).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    try {
      const body = await readFile(join(ROOT, 'docs', rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  step(`screenshot ${path}`);
}

async function rowTitles(page) {
  return page.locator('.rows .row .row-head strong').allTextContents();
}

async function waitCount(page, text) {
  await page.locator('.count', { hasText: text }).waitFor({ timeout: 10_000 });
}

async function addText(page, { text, contact, number, when }) {
  await page.getByRole('button', { name: '텍스트 추가' }).click();
  const dialog = page.locator('dialog.sheet[open]');
  await dialog.waitFor();
  await dialog.locator('textarea[name=text]').fill(text);
  await dialog.locator('input[name=contact]').fill(contact);
  await dialog.locator('input[name=number]').fill(number);
  await dialog.locator('input[name=when]').fill(when);
  await dialog.getByRole('button', { name: '저장' }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function confirmSheet(page, label) {
  const dialog = page.locator('dialog.sheet[open]');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function coreSuite(context, page, base) {
  await page.goto(base);
  await page.locator('.appbar h1', { hasText: '통화 검색' }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
  step('service worker controls the page');
  check((await page.locator('.empty h2').textContent()) === '아직 통화 기록이 없어요', 'empty library state shown');
  await shot(page, 'core-01-empty');

  await addText(page, { text: '내일 오후 세 시에 계약서 들고 사무실로 오세요. 주차는 지하 2층에 하시면 됩니다.', contact: '김과장', number: '010-1111-2222', when: '2026-10-14T14:03' });
  await addText(page, { text: '계약 서류는 다음 주 월요일에 보내 드릴게요. 회의는 화상으로 해요.', contact: '이대리', number: '010-3333-4444', when: '2026-10-16T09:30' });
  await addText(page, { text: '회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.', contact: '김과장', number: '010-1111-2222', when: '2026-10-20T18:10' });
  await waitCount(page, '통화 3건');
  check(JSON.stringify(await rowTitles(page)) === JSON.stringify(['김과장', '이대리', '김과장']), 'three text records listed newest first');

  await page.locator('.searchfield input').fill('계약서');
  await waitCount(page, '검색 결과 2건');
  check(JSON.stringify(await rowTitles(page)) === JSON.stringify(['이대리', '김과장']), 'search 계약서 finds both calls, newest first');
  const marks = await page.locator('.rows mark').allTextContents();
  check(JSON.stringify(marks) === JSON.stringify(['계약 서', '계약서']), `highlighted snippets mark the original text (${JSON.stringify(marks)})`);
  await shot(page, 'core-02-search');

  await page.locator('select[aria-label="상대 고르기"]').selectOption('김과장');
  await waitCount(page, '검색 결과 1건');
  check(JSON.stringify(await rowTitles(page)) === JSON.stringify(['김과장']), 'contact filter narrows to 김과장');
  await page.locator('.chip', { hasText: '초기화' }).click();
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await waitCount(page, '통화 3건');
  await page.locator('input[aria-label="시작 날짜"]').fill('2026-10-15');
  await page.locator('input[aria-label="끝 날짜"]').fill('2026-10-21');
  await waitCount(page, '통화 2건');
  check(JSON.stringify(await rowTitles(page)) === JSON.stringify(['김과장', '이대리']), 'date range 10/15-10/21 keeps the two later calls');
  await page.locator('.chip', { hasText: '초기화' }).click();
  await waitCount(page, '통화 3건');

  await page.locator('.rows .row').first().click();
  await page.locator('.transcript', { hasText: '회의 일정을 금요일 오전으로 바꾸죠.' }).waitFor();
  step('record view shows the full transcript');
  await shot(page, 'core-03-record');
  await page.getByRole('button', { name: '편집' }).click();
  const edit = page.locator('dialog.sheet[open]');
  await edit.locator('input[name=contact]').fill('김부장');
  await edit.getByRole('button', { name: '저장' }).click();
  await edit.waitFor({ state: 'detached' });
  await page.locator('.appbar h1', { hasText: '김부장' }).waitFor();
  step('PASS edited contact name shows in the record header');

  await page.getByRole('button', { name: '복사' }).click();
  await page.locator('.toast', { hasText: '복사했어요' }).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === '회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.', 'copy puts the transcript on the clipboard');

  await page.getByRole('button', { name: 'ChatGPT로 보내기' }).click();
  await confirmSheet(page, '계속');
  await page.waitForFunction(() => window.__shared !== undefined);
  const shared = await page.evaluate(() => window.__shared);
  check(shared.text.startsWith('[통화 기록]') && shared.text.includes('상대: 김부장') && shared.text.includes('회의 일정을 금요일'), 'ChatGPT로 보내기 hands the transcript to the Web Share API');

  await page.getByRole('button', { name: '삭제' }).click();
  await confirmSheet(page, '삭제');
  await waitCount(page, '통화 2건');
  check((await rowTitles(page)).length === 2, 'delete removes the record');

  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.kv', { hasText: '2건' }).waitFor();
  await shot(page, 'core-04-settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 내보내기' }).click()]);
  const backupPath = join(OUT, 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  check(backup.format === 'call-search-backup' && backup.records.length === 2, 'JSON export holds both records');
  await page.getByRole('button', { name: '모든 기록 지우기' }).click();
  await confirmSheet(page, '모두 지우기');
  await page.locator('.kv', { hasText: '0건' }).waitFor();
  step('PASS delete all empties the library');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '백업 가져오기' }).click()]);
  await chooser.setFiles(backupPath);
  await page.locator('.toast', { hasText: '2건 추가' }).waitFor();
  await page.locator('.kv', { hasText: '2건' }).waitFor();
  step('PASS JSON import restores both records');

  await page.goto(base);
  await page.locator('.appbar h1', { hasText: '통화 검색' }).waitFor();
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.id = 'share-form';
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.action = 'share-target';
    for (const [name, value] of [['title', '에이닷 통화 요약'], ['text', '다음 주 수요일 납품 일정을 확정했습니다.']]) {
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      form.append(input);
    }
    const file = document.createElement('input');
    file.type = 'file';
    file.name = 'audio';
    file.id = 'share-file';
    form.append(file);
    document.body.append(form);
  });
  await page.setInputFiles('#share-file', { name: '01025777190_20261020051500.m4a', mimeType: 'audio/mp4', buffer: Buffer.from('not really audio') });
  await Promise.all([page.waitForURL(/#\/import/), page.evaluate(() => document.getElementById('share-form').submit())]);
  step(`share-target POST redirected to ${page.url()}`);
  const review = page.locator('dialog.sheet[open]');
  await review.waitFor();
  const prefilled = await review.locator('textarea[name=text]').inputValue();
  check(prefilled.includes('에이닷 통화 요약') && prefilled.includes('납품 일정'), 'shared text opens prefilled for review');
  await review.locator('input[name=contact]').fill('박팀장');
  await review.getByRole('button', { name: '저장' }).click();
  await review.waitFor({ state: 'detached' });
  await page.locator('.queue .progress .name', { hasText: '01025777190_20261020051500.m4a' }).waitFor();
  check((await page.locator('.queue .progress').count()) === 2, 'both shared items reached the import queue');
  check(new URL(page.url()).search === '', 'share query string is cleaned from the address bar');
  await shot(page, 'core-05-share-import');
  results.shareAudioState = await page.locator('.queue .progress', { hasText: '.m4a' }).getAttribute('class');

  const violation = await page.evaluate(async () => {
    const seen = new Promise((resolve) => document.addEventListener('securitypolicyviolation', (e) => resolve(`${e.violatedDirective} ${e.blockedURI}`), { once: true }));
    const outcome = await fetch('https://example.com/').then(() => 'allowed', () => 'blocked');
    return [outcome, await seen];
  });
  check(violation[0] === 'blocked' && violation[1].startsWith('connect-src'), `CSP blocks a page fetch to example.com (${violation[1]})`);

  await context.setOffline(true);
  await page.goto(base);
  await page.locator('.appbar h1', { hasText: '통화 검색' }).waitFor();
  await page.locator('a.notice', { hasText: '가져오지 않은 항목 1개' }).waitFor();
  step('PASS a failed import waits behind a banner instead of taking over the start screen');
  await page.locator('.searchfield input').fill('납품');
  await waitCount(page, '검색 결과 1건');
  check((await rowTitles(page))[0] === '박팀장', 'offline reload serves the app shell and keyword search works');
  await shot(page, 'core-06-offline');
  await context.setOffline(false);

  await page.locator('.searchfield input').fill('');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'core-07-desktop');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 412, height: 915 });
  await shot(page, 'core-08-dark');
  await page.locator('.rows .row').first().click();
  await page.locator('.transcript').waitFor();
  await shot(page, 'core-09-dark-record');
  await page.emulateMedia({ colorScheme: 'light' });
}

const executablePath = await chromePath();
const server = arg('base') ? null : await serveDocs();
const base = arg('base') ?? `http://127.0.0.1:${server.address().port}/call-search/`;
const profile = await mkdtemp(join(tmpdir(), 'cs-e2e-profile-'));
const hosts = new Map();
const pageErrors = [];
step(`chromium ${executablePath}`);
step(`base ${base}`);
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  viewport: { width: 412, height: 915 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  acceptDownloads: true,
});
let failed = false;
try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.__shared = data; } });
  });
  context.on('request', (request) => {
    const host = new URL(request.url()).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') step(`console error: ${message.text()}`);
  });
  for (const suite of SUITES) {
    step(`suite ${suite}`);
    if (suite === 'core') await coreSuite(context, page, base);
    else throw new Error(`unknown suite ${suite}`);
  }
  check(pageErrors.length === 0, `no uncaught page errors (${pageErrors.join(' | ')})`);
} catch (error) {
  failed = true;
  step(`FAIL ${error instanceof Error ? error.stack : error}`);
  const page = context.pages()[0];
  if (page) await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => undefined);
} finally {
  results.hosts = Object.fromEntries(hosts);
  results.elapsedSeconds = (Date.now() - t0) / 1000;
  results.passed = !failed;
  step(`hosts contacted: ${JSON.stringify(results.hosts)}`);
  await context.close();
  await rm(profile, { recursive: true, force: true });
  server?.close();
  await writeFile(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  await writeFile(join(OUT, 'log.txt'), lines.join('\n') + '\n');
  step(`evidence in ${OUT} (profile removed: ${!existsSync(profile)})`);
}
process.exit(failed ? 1 : 0);
