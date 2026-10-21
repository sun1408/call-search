// End-to-end checks in headless Chromium against the built site (docs/) or a live URL.
// Usage: node scripts/e2e.mjs --suite core [--base https://sun1408.github.io/call-search/] [--out <dir>]
// Chromium: $CHROME_PATH, else the newest Playwright Chromium in ~/.cache/ms-playwright.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const SAMPLES = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/test_wavs/';
const MODEL_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(huggingface\.co|hf\.co)\//;
const asrLog = [];
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
  const modelNotice = page.locator('dialog.sheet[open]', { hasText: '음성 인식 모델 내려받기' });
  await modelNotice.waitFor();
  check((await modelNotice.textContent()).includes('huggingface.co'), 'shared audio asks before downloading the speech model');
  await modelNotice.getByRole('button', { name: '나중에' }).click();
  await modelNotice.waitFor({ state: 'detached' });
  const review = page.locator('dialog.sheet[open]', { hasText: '텍스트로 기록 추가' });
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

async function sample(name) {
  const path = join(OUT, name);
  if (!existsSync(path)) {
    const response = await fetch(SAMPLES + name);
    if (!response.ok) throw new Error(`sample ${name}: HTTP ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return path;
}

async function importAudio(page, path) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.appbar').getByRole('button', { name: '녹음 가져오기' }).click()]);
  await chooser.setFiles(path);
}

async function openHome(page, base) {
  await page.goto(base);
  await page.locator('.appbar h1', { hasText: '통화 검색' }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
}

async function asrSuite(context, page, base) {
  const ko = await sample('ko.wav');
  const first = join(OUT, '01012345678_20261020051500.wav');
  await copyFile(ko, first);
  await openHome(page, base);
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.panel p', { hasText: '아직 모델을 받지 않았어요' }).waitFor();
  step('PASS settings shows the speech model is not downloaded yet');
  await page.locator('.tab', { hasText: '검색' }).click();
  await importAudio(page, first);
  const notice = page.locator('dialog.sheet[open]');
  await notice.waitFor();
  const noticeText = await notice.textContent();
  check(/약 2\d\d MB/.test(noticeText) && noticeText.includes('huggingface.co'), `size notice shown before the first download (${noticeText.match(/약 \d+ MB/)?.[0]})`);
  await shot(page, 'asr-01-size-notice');
  const started = Date.now();
  await notice.getByRole('button', { name: /^내려받기/ }).click();
  await page.locator('.queue .progress .detail', { hasText: '모델 내려받는 중' }).waitFor({ timeout: 60_000 });
  await shot(page, 'asr-02-downloading');
  await page.locator('.queue .progress .detail', { hasText: '음성 인식 엔진 준비 중' }).waitFor({ timeout: 20 * 60_000 });
  results.downloadSeconds = (Date.now() - started) / 1000;
  step(`model downloaded and cached in ${results.downloadSeconds}s`);
  await page.locator('.queue .progress.done').first().waitFor({ timeout: 20 * 60_000 });
  results.firstImportSeconds = (Date.now() - started) / 1000;
  results.asrLog = [...asrLog];
  step(`first import done in ${results.firstImportSeconds}s; ${asrLog.join(' | ')}`);
  await page.locator('.queue .progress.done a', { hasText: '기록 보기' }).first().click();
  await page.locator('.transcript p').first().waitFor();
  const text = (await page.locator('.transcript').innerText()).trim();
  results.koText = text;
  check(text.includes('생각') && text.includes('훨씬 편할 거야'), `ko.wav transcript kept as recognized (${text.replace(/\s+/g, ' ')})`);
  const meta = await page.locator('.record-head .meta').first().innerText();
  check(meta.includes('2026년 10월 20일') && meta.includes('오후 2:15'), `UTC stamp 05:15 shows as 14:15 KST (${meta.replace(/\s+/g, ' ')})`);
  check((await page.locator('.appbar h1').textContent()) === '010-1234-5678', 'number from the file name becomes the title');
  await shot(page, 'asr-03-record');
  await page.locator('.tab', { hasText: '검색' }).click();
  await page.locator('.searchfield input').fill('조금만');
  await waitCount(page, '검색 결과 1건');
  const asrMarks = await page.locator('.rows mark').allTextContents();
  check(asrMarks.length > 0 && asrMarks[0].replace(/\s+/g, '') === '조금만', `searching 조금만 finds the transcript even with SenseVoice's spacing (${JSON.stringify(asrMarks)})`);
  await page.locator('.searchfield input').fill('');
  await page.locator('.rows .row').first().click();
  await page.locator('.transcript p').first().waitFor();

  const worker = page.workers().find((w) => w.url().endsWith('/asr-worker.js'));
  check(Boolean(worker), 'speech worker is running');
  const workerFetch = await worker.evaluate(() => fetch('https://example.com/').then(() => 'allowed', () => 'blocked'));
  check(workerFetch === 'blocked', 'CSP blocks a fetch to example.com from inside the speech worker');

  let modelRequests = 0;
  const countModelHosts = (request) => {
    if (MODEL_HOSTS.test(request.url())) modelRequests++;
  };
  context.on('request', countModelHosts);
  await context.route(MODEL_HOSTS, (route) => route.abort());
  const second = join(OUT, '통화 녹음 홍길동_261021_093012.wav');
  await copyFile(ko, second);
  await page.locator('.tab', { hasText: '검색' }).click();
  await importAudio(page, second);
  await page.locator('.queue .progress.done', { hasText: '홍길동' }).waitFor({ timeout: 10 * 60_000 });
  check((await page.locator('dialog.sheet[open]').count()) === 0 && modelRequests === 0, 'second import runs from the cached model with Hugging Face blocked and no download notice');
  await context.unroute(MODEL_HOSTS);
  context.off('request', countModelHosts);

  await context.setOffline(true);
  await openHome(page, base);
  const third = join(OUT, '01099998888_20261021000000.wav');
  await copyFile(ko, third);
  await importAudio(page, third);
  await page.locator('.queue .progress.done', { hasText: '01099998888' }).waitFor({ timeout: 10 * 60_000 });
  step('PASS after an offline reload the cached engine still transcribes');
  await shot(page, 'asr-04-offline-import');
  await context.setOffline(false);
  results.asrLog = [...asrLog];
}

const FORMATS = [
  { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '48k'] },
  { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '48k'] },
  { ext: 'ogg', args: ['-c:a', 'libopus', '-b:a', '24k'] },
];

async function pickFormat(page) {
  const ko = await sample('ko.wav');
  results.decodes = {};
  let chosen = null;
  for (const format of FORMATS) {
    const path = join(OUT, `probe.${format.ext}`);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', ko, ...format.args, '-ac', '1', path]);
    const outcome = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer);
        return `ok ${audio.duration.toFixed(2)}s`;
      } catch (error) {
        return `fail ${error}`;
      }
    }, (await readFile(path)).toString('base64'));
    results.decodes[format.ext] = outcome;
    step(`decodeAudioData(${format.ext}) in this Chromium: ${outcome}`);
    if (!chosen && outcome.startsWith('ok')) chosen = format;
  }
  if (!chosen) throw new Error('this Chromium decodes none of m4a, mp3, ogg');
  return chosen;
}

async function makeLongCall(minutes, format) {
  const wav = await readFile(await sample('ko.wav'));
  const at = wav.indexOf(Buffer.from('data'));
  const speech = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  const perMinute = 16_000 * 60 * 2;
  const pcm = Buffer.alloc(perMinute * minutes);
  let seed = 12345;
  for (let i = 0; i < pcm.length; i += 2) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pcm.writeInt16LE((seed % 41) - 20, i);
  }
  for (let m = 0; m < minutes; m++) speech.copy(pcm, m * perMinute);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const wavPath = join(OUT, 'long-call.wav');
  await writeFile(wavPath, Buffer.concat([header, pcm]));
  const encoded = join(OUT, `01055556666_20261019013000.${format.ext}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, ...format.args, '-ac', '1', encoded]);
  await rm(wavPath);
  return encoded;
}

async function chromeRssMb() {
  try {
    const { stdout } = await run('ps', ['-C', 'chrome', '-o', 'rss=']);
    return Math.round(stdout.split(/\s+/).filter(Boolean).reduce((sum, kb) => sum + Number(kb), 0) / 1024);
  } catch {
    return 0;
  }
}

async function longSuite(context, page, base) {
  const minutes = Number(arg('minutes', '30'));
  await openHome(page, base);
  const format = await pickFormat(page);
  const file = await makeLongCall(minutes, format);
  results.longFile = `${minutes} min ${format.ext}, ${((await stat(file)).size / 1e6).toFixed(1)} MB`;
  step(`long call file: ${results.longFile}`);
  const started = Date.now();
  await importAudio(page, file);
  const progress = [];
  let peakRss = 0;
  let state = null;
  for (;;) {
    state = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.queue .progress')].find((r) => r.textContent.includes('01055556666'));
      if (!row) return null;
      const bar = row.querySelector('[role=progressbar]');
      return { cls: row.className, value: bar ? Number(bar.getAttribute('aria-valuenow')) : null, detail: row.querySelector('.detail')?.textContent ?? '' };
    });
    peakRss = Math.max(peakRss, await chromeRssMb());
    if (state?.detail.startsWith('글로 바꾸는 중')) progress.push(state.value);
    if (state && /done|error/.test(state.cls)) break;
    if (Date.now() - started > 60 * 60_000) throw new Error('long call did not finish within 60 minutes');
    await page.waitForTimeout(2000);
  }
  results.long = { seconds: (Date.now() - started) / 1000, progressSamples: progress.length, firstAndLast: [progress[0], progress[progress.length - 1]], peakChromeRssMb: peakRss, final: state };
  check(state.cls.includes('done'), `${minutes}-minute call finished (${state.detail})`);
  check(progress.length >= 3 && progress.every((v, i) => i === 0 || v >= progress[i - 1]), `progress was reported ${progress.length} times and never went backwards`);
  await page.locator('.queue .progress.done a', { hasText: '기록 보기' }).last().click();
  await page.locator('.transcript p').first().waitFor();
  const segments = await page.locator('.transcript p').count();
  const meta = await page.locator('.record-head .meta').first().innerText();
  results.long.segments = segments;
  results.long.meta = meta;
  check(segments >= minutes * 0.8 && meta.includes(`${minutes}분`), `record has ${segments} timed segments and duration ${minutes}분 (${meta.replace(/\s+/g, ' ')})`);
  results.asrLog = [...asrLog];
  await shot(page, 'long-01-record');
}

async function aiSuite(context, page, base) {
  await openHome(page, base);
  check((await page.evaluate(() => 'gpu' in navigator)) === false, 'WebGPU is hidden in this run to exercise the no-WebGPU fallback');
  await addText(page, { text: '내일 오후 세 시에 계약서 들고 사무실로 오세요. 주차는 지하 2층에 하시면 됩니다.', contact: '김과장', number: '010-1111-2222', when: '2026-10-14T14:03' });
  await addText(page, { text: '계약 서류는 다음 주 월요일에 보내 드릴게요. 회의는 화상으로 해요.', contact: '이대리', number: '010-3333-4444', when: '2026-10-16T09:30' });
  await addText(page, { text: '회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.', contact: '김과장', number: '010-1111-2222', when: '2026-10-20T18:10' });
  await waitCount(page, '통화 3건');

  await page.locator('.tab', { hasText: '설정' }).click();
  await page.getByRole('button', { name: 'AI 검색 켜기' }).click();
  const notice = page.locator('dialog.sheet[open]', { hasText: 'AI 검색 켜기' });
  await notice.waitFor();
  check((await notice.textContent()).includes('MB') && (await notice.textContent()).includes('huggingface.co'), 'AI search asks before downloading its model, with the size and host');
  await shot(page, 'ai-01-notice');
  const started = Date.now();
  await notice.getByRole('button', { name: /^내려받기/ }).click();
  await page.locator('.panel p', { hasText: '통화 조각' }).waitFor({ timeout: 15 * 60_000 });
  results.embeddingSetupSeconds = (Date.now() - started) / 1000;
  step(`embedding model downloaded and 3 calls indexed in ${results.embeddingSetupSeconds}s (${await page.locator('.panel p', { hasText: '통화 조각' }).textContent()})`);
  check((await page.locator('.panel p', { hasText: 'WebGPU' }).count()) > 0, 'settings explains that AI answers need WebGPU here');
  await shot(page, 'ai-02-settings');

  await page.locator('.tab', { hasText: '검색' }).click();
  await page.locator('.searchfield input').fill('미팅 날짜 변경');
  await page.locator('.similar .row').first().waitFor({ timeout: 60_000 });
  const similar = await page.locator('.similar .row .snippet').allTextContents();
  results.similar = similar;
  check((await page.locator('.rows .row').count()) === (await page.locator('.similar .row').count()) && similar[0].includes('회의 일정'), `a paraphrase with no shared words finds the schedule-change call first (${JSON.stringify(similar)})`);
  await shot(page, 'ai-03-similar');
  await page.locator('.searchfield input').fill('');

  await page.locator('.tab', { hasText: '물어보기' }).click();
  const question = '김과장이 회의를 언제로 옮기자고 했어?';
  await page.locator('.composer textarea').fill(question);
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  const turn = page.locator('.turn').last();
  await turn.locator('.notice', { hasText: 'WebGPU' }).waitFor({ timeout: 120_000 });
  const fallbackRows = await turn.locator('.rows .row .row-head strong').allTextContents();
  const firstSnippet = await turn.locator('.rows .row .snippet').first().textContent();
  results.askFallback = { note: await turn.locator('.notice').textContent(), rows: fallbackRows, firstSnippet };
  check(fallbackRows.length > 0 && fallbackRows.every((n) => n === '김과장') && firstSnippet.includes('회의 일정'), `without WebGPU the answer falls back to 김과장's related calls, schedule change first (${JSON.stringify(fallbackRows)})`);
  await shot(page, 'ai-04-ask-fallback');
  await turn.locator('.rows .row').first().click();
  await page.locator('.transcript', { hasText: '회의 일정을 금요일' }).waitFor();
  step('PASS a fallback result opens the call it came from');
  await page.goBack();
  await page.locator('.turn').last().waitFor();

  await page.locator('.turn').last().getByRole('button', { name: 'ChatGPT에 물어보기' }).click();
  const shareSheet = page.locator('dialog.sheet[open]', { hasText: 'ChatGPT에 물어보기' });
  await shareSheet.waitFor();
  check((await shareSheet.textContent()).includes('휴대폰 밖'), 'ChatGPT share warns that the text leaves the phone');
  await shot(page, 'ai-05-share-notice');
  await page.evaluate(() => { window.__shared = undefined; });
  await shareSheet.getByRole('button', { name: '보내기' }).click();
  await page.waitForFunction(() => window.__shared !== undefined);
  const payload = (await page.evaluate(() => window.__shared)).text;
  results.chatgptPayload = payload;
  check(payload.includes(`질문: ${question}`) && payload.includes('회의 일정을 금요일') && !payload.includes('계약 서류는 다음 주'), 'the shared text holds the question and the retrieved snippets only (the unrelated 이대리 call is absent)');
}

async function whisperSuite(context, page, base) {
  await openHome(page, base);
  await page.locator('.tab', { hasText: '설정' }).click();
  const engine = page.locator('select[aria-label="음성 인식 엔진"]');
  await page.locator('.engine-note', { hasText: 'Whisper' }).waitFor();
  check(await engine.locator('option[value="whisper"]').evaluate((option) => option.disabled), 'without WebGPU the Whisper option is disabled');
  const reason = await page.locator('.engine-note').textContent();
  check(reason.includes('WebGPU') && !reason.includes('AI 답변'), `and its own reason is shown (${reason})`);
  await shot(page, 'whisper-01-disabled');

  await page.evaluate(() => localStorage.setItem('cs.whisperModel', JSON.stringify({ id: 'onnx-community/whisper-base', revision: '1846881b6b3a3024392c1eea3ad983695bc23925', dtype: 'q8', bytes: 77_000_000, device: 'wasm', label: 'Whisper base (QA)' })));
  await page.reload();
  await page.locator('.engine-note', { hasText: 'Whisper' }).waitFor();
  await engine.selectOption('whisper');
  await page.locator('.toast', { hasText: 'Whisper' }).waitFor();
  const ko = await sample('ko.wav');
  const file = join(OUT, '01022223333_20261021020000.wav');
  await copyFile(ko, file);
  await page.locator('.tab', { hasText: '검색' }).click();
  await importAudio(page, file);
  const notice = page.locator('dialog.sheet[open]', { hasText: 'Whisper 모델 내려받기' });
  await notice.waitFor();
  const started = Date.now();
  await notice.getByRole('button', { name: /^내려받기/ }).click();
  const row = page.locator('.queue .progress', { hasText: '01022223333' });
  await row.and(page.locator('.done, .error')).waitFor({ timeout: 20 * 60_000 });
  const outcome = await row.getAttribute('class');
  results.whisperSeconds = (Date.now() - started) / 1000;
  check(outcome.includes('done'), `Whisper import finished (${await row.locator('.detail').textContent()})`);
  await row.locator('a', { hasText: '기록 보기' }).click();
  await page.locator('.transcript p').first().waitFor();
  const text = (await page.locator('.transcript').innerText()).trim();
  results.whisperText = text;
  check(/[가-힣]{2,}/.test(text), `the Whisper code path wrote Korean text in ${results.whisperSeconds}s (${text.replace(/\s+/g, ' ')})`);
  await shot(page, 'whisper-02-record');
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
  if (SUITES.includes('ai') || SUITES.includes('whisper')) await context.addInitScript(() => { delete Navigator.prototype.gpu; });
  context.on('request', (request) => {
    const host = new URL(request.url()).host;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') step(`console error: ${message.text()}`);
    if (message.text().startsWith('[asr]')) {
      asrLog.push(message.text());
      step(message.text());
    }
  });
  for (const suite of SUITES) {
    step(`suite ${suite}`);
    if (suite === 'core') await coreSuite(context, page, base);
    else if (suite === 'asr') await asrSuite(context, page, base);
    else if (suite === 'long') await longSuite(context, page, base);
    else if (suite === 'ai') await aiSuite(context, page, base);
    else if (suite === 'whisper') await whisperSuite(context, page, base);
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
