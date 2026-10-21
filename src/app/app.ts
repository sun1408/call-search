import { CHAT_MODELS, EMBEDDING_MODEL } from '../core/ai-protocol';
import { BackupError, makeBackup, parseBackup, planMerge } from '../core/backup';
import {
  dayEnd,
  dayStart,
  displayName,
  formatBytes,
  formatClock,
  formatDuration,
  formatFull,
  formatShortDateTime,
  formatWhen,
  fromLocalInput,
  recordShareText,
  toLocalInput,
} from '../core/format';
import { formatNumber, normalizeNumber } from '../core/phone';
import { retrieve } from '../core/retrieval';
import {
  findRanges,
  highlight,
  listPeople,
  makeDoc,
  matchesFilters,
  mergeRanges,
  newestFirst,
  normalizeForSearch,
  queryTerms,
  search,
  type SearchDoc,
  type SearchFilters,
  type SearchHit,
} from '../core/search';
import type { Store } from '../core/store';
import type { CallRecord, InboxItem, RecordPatch } from '../core/types';
import { ChatEngine, SemanticIndex, chatModel, deleteCachedModel, isModelCached } from './ai';
import { AskView } from './ask';
import { SenseVoiceTranscriber } from './asr';
import { append, h, icon, marked, type Child } from './dom';
import type { IconName } from './icons';
import { AUDIO_ACCEPT, Importer, type QueueEntry } from './importer';
import { downloadPack, isPackCached, packBytes, removePack, type ModelPack } from './models';
import { EngineSwitch, WhisperTranscriber, whisperModel } from './whisper';
import { confirmSheet, openSheet, toast } from './ui';

declare const __VERSION__: string;

export type Route = { name: 'search' } | { name: 'record'; id: string } | { name: 'import' } | { name: 'ask' } | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const record = path.match(/^\/r\/(.+)$/);
  if (record) return { name: 'record', id: decodeURIComponent(record[1]!) };
  if (path === '/import') return { name: 'import' };
  if (path === '/ask') return { name: 'ask' };
  if (path === '/settings') return { name: 'settings' };
  return { name: 'search' };
}

const PAGE_SIZE = 50;
const pad = (n: number) => String(n).padStart(2, '0');

function iconButton(name: IconName, label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

function button(label: string, variant: 'primary' | 'secondary' | 'ghost' | 'danger', onclick: () => void, iconName?: IconName): HTMLButtonElement {
  return h('button', { class: `btn btn-${variant}`, type: 'button', onclick }, iconName ? icon(iconName, 20) : null, label);
}

function field(label: string, control: HTMLElement, help?: string): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', null, label), control, help ? h('small', null, help) : null);
}

export async function shareText(title: string, text: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('공유 화면을 열 수 없어 내용을 복사했어요. ChatGPT에 붙여 넣으세요.');
  } catch {
    toast('공유하지 못했어요.');
  }
}

export class App {
  private records: CallRecord[] = [];
  private readonly docs = new Map<string, SearchDoc>();
  private query = '';
  private person = '';
  private from = '';
  private to = '';
  private shown = PAGE_SIZE;
  private searchScroll = 0;
  private resultsQueued = false;
  private queueQueued = false;
  private navigated = false;
  private route: Route = { name: 'search' };

  private readonly header = h('header', { class: 'appbar' });
  private readonly main = h('main', { class: 'main' });
  private readonly tabs: Array<{ el: HTMLAnchorElement; routes: Route['name'][] }> = [];
  private readonly tabbar = h('nav', { class: 'tabbar', 'aria-label': '주 메뉴' });
  private readonly searchInput: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly personSelect: HTMLSelectElement;
  private readonly fromInput: HTMLInputElement;
  private readonly toInput: HTMLInputElement;
  private readonly resetChip: HTMLButtonElement;
  private readonly countLine = h('p', { class: 'count', 'aria-live': 'polite' });
  private readonly results = h('div', { class: 'results' });
  private readonly importBanner: HTMLAnchorElement;
  private readonly searchRoot: HTMLElement;
  private readonly filePicker: HTMLInputElement;
  readonly importer: Importer;
  readonly transcriber: SenseVoiceTranscriber;
  readonly index: SemanticIndex;
  readonly chat: ChatEngine;
  readonly whisper: WhisperTranscriber;
  private readonly engines: EngineSwitch;
  private readonly askView: AskView;
  private readonly similar = h('section', { class: 'similar', hidden: true });
  private similarTimer: ReturnType<typeof setTimeout> | undefined;
  private indexTimer: ReturnType<typeof setTimeout> | undefined;
  private aiPanelRefresh: (() => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly root: HTMLElement,
  ) {
    this.transcriber = new SenseVoiceTranscriber((pack) => this.askModelDownload(pack));
    this.index = new SemanticIndex(store, () => this.aiChanged());
    this.chat = new ChatEngine(() => this.aiChanged());
    this.whisper = new WhisperTranscriber(store, (label, bytes) => this.askWhisperDownload(label, bytes), () => this.chat.support());
    this.engines = new EngineSwitch(store, { sensevoice: this.transcriber, whisper: this.whisper });
    this.askView = new AskView({
      store,
      index: this.index,
      chat: this.chat,
      records: () => this.records,
      share: shareText,
      askEmbeddingDownload: () => this.askEmbeddingDownload(),
      askChatDownload: (label, bytes) => this.askChatDownload(label, bytes),
    });
    this.importer = new Importer(store, this.engines, {
      changed: () => this.queueChanged(),
      recordAdded: (record) => this.upsert(record),
      reviewText: (item) => this.reviewSharedText(item),
    });

    this.searchInput = h('input', {
      type: 'search',
      placeholder: '통화 내용, 이름, 번호로 검색',
      'aria-label': '통화 검색',
      enterkeyhint: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.shown = PAGE_SIZE;
      this.clearButton.hidden = this.query === '';
      this.scheduleResults();
    });
    this.clearButton = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '검색어 지우기', hidden: true }, icon('x', 20));
    this.clearButton.addEventListener('click', () => {
      this.searchInput.value = '';
      this.query = '';
      this.clearButton.hidden = true;
      this.updateResults();
      this.searchInput.focus();
    });

    this.personSelect = h('select', { 'aria-label': '상대 고르기' });
    this.personSelect.addEventListener('change', () => {
      this.person = this.personSelect.value;
      this.filtersChanged();
    });
    this.fromInput = h('input', { type: 'date', 'aria-label': '시작 날짜' });
    this.fromInput.addEventListener('change', () => {
      this.from = this.fromInput.value;
      this.filtersChanged();
    });
    this.toInput = h('input', { type: 'date', 'aria-label': '끝 날짜' });
    this.toInput.addEventListener('change', () => {
      this.to = this.toInput.value;
      this.filtersChanged();
    });
    this.resetChip = h('button', { class: 'chip', type: 'button', hidden: true, onclick: () => this.resetFilters() }, icon('x', 16), '초기화');

    this.importBanner = h('a', { class: 'notice', href: '#/import', hidden: true });

    this.searchRoot = h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'searchbar' },
        h('label', { class: 'searchfield' }, icon('search', 20), this.searchInput, this.clearButton),
        h(
          'div',
          { class: 'filters' },
          h('label', { class: 'chip', 'data-filter': 'person' }, icon('user', 16), this.personSelect),
          h('label', { class: 'chip', 'data-filter': 'from' }, icon('calendar', 16), this.fromInput),
          h('span', { class: 'muted', 'aria-hidden': 'true' }, '~'),
          h('label', { class: 'chip', 'data-filter': 'to' }, icon('calendar', 16), this.toInput),
          this.resetChip,
        ),
      ),
      this.importBanner,
      this.countLine,
      this.results,
      this.similar,
    );

    this.filePicker = h('input', { type: 'file', accept: AUDIO_ACCEPT, multiple: true, hidden: true });
    this.filePicker.addEventListener('change', () => {
      const files = [...(this.filePicker.files ?? [])];
      if (files.length === 0) return;
      location.hash = '#/import';
      void this.importer.addFiles(files);
    });

    this.addTab('#/', '검색', 'search', ['search', 'record', 'import']);
    this.addTab('#/ask', '물어보기', 'message-chatbot', ['ask']);
    this.addTab('#/settings', '설정', 'settings', ['settings']);
  }

  private addTab(href: string, label: string, iconName: IconName, routes: Route['name'][]): void {
    const el = h('a', { class: 'tab', href }, h('span', { class: 'pill' }, icon(iconName, 22)), h('span', null, label));
    this.tabs.push({ el, routes });
    this.tabbar.append(el);
  }

  async start(): Promise<void> {
    this.records = await this.store.listRecords();
    for (const record of this.records) this.docs.set(record.id, makeDoc(record));
    await this.index.restore(this.records);
    this.root.replaceChildren(this.header, this.main, this.tabbar, this.filePicker);
    window.addEventListener('hashchange', () => {
      this.navigated = true;
      this.render();
    });
    this.render();
    await this.receiveShared();
  }

  offerUpdate(apply: () => void): void {
    toast('새 버전이 준비됐어요.', { label: '새로 고침', run: apply }, 0);
  }

  private async receiveShared(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const shared = params.has('share');
    if (params.has('share-error')) toast('공유한 항목을 받지 못했어요. 다시 공유해 주세요.');
    if (shared || params.has('share-error')) history.replaceState(null, '', location.pathname + location.hash);
    await this.importer.load();
    if (!shared) return;
    if (this.route.name !== 'import') location.hash = '#/import';
    await this.importer.run();
  }

  private render(): void {
    const next = parseRoute(location.hash);
    if (this.route.name === 'search' && next.name !== 'search') this.searchScroll = this.main.scrollTop;
    this.route = next;
    for (const tab of this.tabs) {
      if (tab.routes.includes(next.name)) tab.el.setAttribute('aria-current', 'page');
      else tab.el.removeAttribute('aria-current');
    }
    if (next.name === 'record') this.showRecord(next.id);
    else if (next.name === 'import') this.showImport();
    else if (next.name === 'ask') this.showAsk();
    else if (next.name === 'settings') void this.showSettings();
    else this.showSearch();
  }

  private setHeader(title: string, back: boolean, actions: Child[] = []): void {
    this.header.className = back ? 'appbar with-back' : 'appbar';
    this.header.replaceChildren();
    append(this.header, [back ? iconButton('arrow-left', '뒤로', () => this.back()) : null, h('h1', null, title), actions]);
  }

  private back(): void {
    if (this.navigated && history.length > 1) history.back();
    else location.hash = '#/';
  }

  private pickAudio(): void {
    this.filePicker.value = '';
    this.filePicker.click();
  }

  private showSearch(): void {
    this.setHeader('통화 검색', false, [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.pickAudio() }, icon('file-music', 20), '녹음 가져오기'),
      iconButton('file-text', '텍스트 추가', () => void this.addTextDialog()),
    ]);
    this.main.replaceChildren(this.searchRoot);
    this.updateResults();
    this.updateBanner();
    this.main.scrollTop = this.searchScroll;
  }

  private filters(): SearchFilters {
    return {
      person: this.person || undefined,
      from: this.from ? dayStart(this.from) : undefined,
      to: this.to ? dayEnd(this.to) : undefined,
    };
  }

  private filtersChanged(): void {
    this.shown = PAGE_SIZE;
    this.updateResults();
  }

  private resetFilters(): void {
    this.person = '';
    this.from = '';
    this.to = '';
    this.filtersChanged();
  }

  private syncFilterControls(): void {
    const people = listPeople(this.records);
    if (this.person && !people.some((p) => p.key === this.person)) this.person = '';
    this.personSelect.replaceChildren(
      h('option', { value: '' }, '모든 상대'),
      ...people.map((p) => h('option', { value: p.key }, `${p.key} (${p.count})`)),
    );
    this.personSelect.value = this.person;
    this.fromInput.value = this.from;
    this.toInput.value = this.to;
    for (const [name, value] of [['person', this.person], ['from', this.from], ['to', this.to]] as const) {
      this.searchRoot.querySelector(`[data-filter="${name}"]`)?.classList.toggle('active', value !== '');
    }
    this.resetChip.hidden = !(this.person || this.from || this.to);
  }

  private scheduleResults(): void {
    if (this.resultsQueued) return;
    this.resultsQueued = true;
    requestAnimationFrame(() => {
      this.resultsQueued = false;
      if (this.route.name === 'search') this.updateResults();
    });
  }

  private updateResults(): void {
    this.syncFilterControls();
    if (this.records.length === 0) {
      this.countLine.hidden = true;
      this.results.replaceChildren(this.emptyLibrary());
      return;
    }
    const hits = search([...this.docs.values()], this.query, this.filters());
    this.countLine.hidden = false;
    this.countLine.textContent = this.query.trim() ? `검색 결과 ${hits.length}건` : `통화 ${hits.length}건`;
    if (hits.length === 0) {
      this.results.replaceChildren(this.emptyResults());
      this.scheduleSimilar();
      return;
    }
    const list = h('ul', { class: 'rows' }, hits.slice(0, this.shown).map((hit) => h('li', null, this.row(hit))));
    const rest = hits.length - this.shown;
    const more = rest > 0
      ? h('button', { class: 'btn btn-secondary btn-block more', type: 'button', onclick: () => { this.shown += PAGE_SIZE; this.updateResults(); } }, `더 보기 (${rest}건 남음)`)
      : null;
    this.results.replaceChildren(list);
    if (more) this.results.append(more);
    this.scheduleSimilar();
  }

  private scheduleSimilar(): void {
    clearTimeout(this.similarTimer);
    const query = this.query.trim();
    if (query.length < 2 || !this.index.isReady) {
      this.similar.hidden = true;
      return;
    }
    this.similarTimer = setTimeout(() => void this.showSimilar(query), 400);
  }

  private async showSimilar(query: string): Promise<void> {
    try {
      const vector = await this.index.queryVector(query);
      if (query !== this.query.trim() || this.route.name !== 'search') return;
      const filters = this.filters();
      const byId = new Map(this.records.map((r) => [r.id, r]));
      const keywordHits = new Set(search([...this.docs.values()], query, filters).map((hit) => hit.record.id));
      const hits = retrieve(vector, query, this.index.chunks, byId, { people: [], matched: [] }, { topK: 20, perRecord: 1 })
        .filter((s) => !keywordHits.has(s.record.id) && matchesFilters(s.record, filters) && s.semantic >= 0.8)
        .slice(0, 5);
      this.similar.hidden = hits.length === 0;
      this.similar.replaceChildren(
        h('h2', null, '뜻이 비슷한 통화'),
        h(
          'ul',
          { class: 'rows' },
          hits.map((s) =>
            h(
              'li',
              null,
              h(
                'a',
                { class: 'row', href: `#/r/${encodeURIComponent(s.record.id)}` },
                h('div', { class: 'row-head' }, h('strong', null, displayName(s.record)), h('time', null, formatWhen(s.record.date))),
                h('p', { class: 'snippet' }, s.chunk.text),
              ),
            ),
          ),
        ),
      );
    } catch {
      this.similar.hidden = true;
    }
  }

  private scheduleIndexSync(): void {
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => {
      void this.index.isEnabled().then((enabled) => (enabled ? this.index.sync(this.records) : undefined)).catch(() => undefined);
    }, 800);
  }

  private aiChanged(): void {
    if (this.route.name === 'ask') this.askView.scheduleRender();
    this.aiPanelRefresh?.();
  }

  private showAsk(): void {
    this.setHeader('물어보기', false, [iconButton('refresh', '새 대화', () => this.askView.clear())]);
    this.main.replaceChildren(this.askView.root);
    this.askView.render();
  }

  private async askEmbeddingDownload(): Promise<boolean> {
    const size = formatBytes(EMBEDDING_MODEL.bytes);
    const { value } = await openSheet(
      'AI 검색 켜기',
      [
        h('p', null, `질문의 뜻으로 통화를 찾으려면 AI 검색 모델(${EMBEDDING_MODEL.label}, 약 ${size})을 한 번 내려받아야 해요.`),
        h('div', { class: 'notice' }, icon('shield-lock', 22), h('div', null, h('strong', null, '통화 내용은 휴대폰 밖으로 나가지 않아요'), h('p', null, '모델 파일만 huggingface.co에서 받고, 통화 글을 분석하는 일은 모두 이 휴대폰 안에서 해요.'))),
      ],
      [
        { label: '나중에', value: 'cancel' },
        { label: `내려받기 (${size})`, value: 'ok', variant: 'primary' },
      ],
    );
    return value === 'ok';
  }

  private async askChatDownload(label: string, bytes: number): Promise<boolean> {
    const size = formatBytes(bytes);
    const { value } = await openSheet(
      'AI 답변 모델 내려받기',
      [
        h('p', null, `질문에 문장으로 답하려면 AI 답변 모델(${label}, 약 ${size})을 한 번 내려받아야 해요. 크기가 커서 Wi-Fi에서 받기를 권해요.`),
        h('p', null, '모델은 huggingface.co에서 받고, 질문과 통화 글은 이 휴대폰의 GPU에서만 처리해요.'),
      ],
      [
        { label: '나중에', value: 'cancel' },
        { label: `내려받기 (${size})`, value: 'ok', variant: 'primary' },
      ],
    );
    return value === 'ok';
  }

  private row(hit: SearchHit): HTMLAnchorElement {
    const record = hit.record;
    const badges: Child[] = [
      h(
        'span',
        { class: 'badge' },
        icon(record.source === 'audio' ? 'microphone' : 'file-text', 14),
        record.source === 'audio' ? (record.durationSec ? formatDuration(record.durationSec) : '녹음') : '텍스트',
      ),
    ];
    if (record.contact && record.number) badges.push(h('span', { class: 'badge' }, formatNumber(record.number)));
    if (this.query.trim() && hit.ranges.length > 0) badges.push(h('span', { class: 'badge' }, `${hit.ranges.length}곳`));
    const snippet = hit.snippets.flatMap((parts, i) => (i === 0 ? marked(parts) : [document.createTextNode(' '), ...marked(parts)]));
    return h(
      'a',
      { class: 'row', href: `#/r/${encodeURIComponent(record.id)}` },
      h('div', { class: 'row-head' }, h('strong', null, displayName(record)), h('time', { datetime: new Date(record.date).toISOString() }, formatWhen(record.date))),
      h('p', { class: 'snippet' }, snippet),
      h('div', { class: 'row-meta' }, badges),
    );
  }

  private emptyLibrary(): HTMLElement {
    return h(
      'div',
      { class: 'empty' },
      icon('file-music', 40),
      h('h2', null, '아직 통화 기록이 없어요'),
      h('p', null, '통화 녹음을 가져오면 휴대폰 안에서 글로 바꿔 검색할 수 있어요. 녹음과 글은 휴대폰 밖으로 나가지 않아요.'),
      h('div', { class: 'actions' }, button('녹음 가져오기', 'primary', () => this.pickAudio(), 'file-music'), button('텍스트 붙여넣기', 'secondary', () => void this.addTextDialog(), 'file-text')),
      h(
        'div',
        { class: 'notice' },
        icon('share', 22),
        h(
          'div',
          null,
          h('strong', null, '공유로 바로 가져오기'),
          h('p', null, '앱을 홈 화면에 설치한 뒤 내 파일 앱의 Recordings > TPhoneCallRecords에서 녹음을 길게 눌러 공유 > 통화 검색을 고르세요. 여러 개를 한 번에 골라도 돼요. 에이닷에서 복사한 글도 공유하거나 붙여 넣을 수 있어요.'),
        ),
      ),
    );
  }

  private emptyResults(): HTMLElement {
    const filtered = Boolean(this.person || this.from || this.to);
    return h(
      'div',
      { class: 'empty' },
      icon('search', 40),
      h('h2', null, '찾는 통화가 없어요'),
      h(
        'p',
        null,
        !this.query.trim()
          ? '고른 조건에 맞는 통화가 없어요.'
          : this.index.isReady
            ? '글자가 그대로 들어간 통화는 없어요. 뜻이 비슷한 통화가 있으면 아래에 보여 드려요.'
            : '띄어쓰기는 상관없이 찾아요. 다른 낱말로 찾아보세요.',
      ),
      filtered ? button('필터 초기화', 'secondary', () => this.resetFilters()) : null,
    );
  }

  private upsert(record: CallRecord, refresh = true): void {
    const at = this.records.findIndex((r) => r.id === record.id);
    if (at >= 0) this.records[at] = record;
    else this.records.push(record);
    this.records.sort(newestFirst);
    this.docs.set(record.id, makeDoc(record));
    if (this.records.length === 1) void navigator.storage?.persist?.();
    if (refresh && this.route.name === 'search') this.updateResults();
    this.scheduleIndexSync();
  }

  private forget(id: string): void {
    this.records = this.records.filter((r) => r.id !== id);
    this.docs.delete(id);
    this.index.chunks = this.index.chunks.filter((c) => c.recordId !== id);
    this.scheduleIndexSync();
  }

  private showRecord(id: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) {
      this.setHeader('통화 기록', true);
      this.main.replaceChildren(
        h('div', { class: 'page' }, h('div', { class: 'empty' }, icon('alert-triangle', 40), h('h2', null, '기록을 찾을 수 없어요'), h('p', null, '지워졌거나 다른 기기에서 만든 링크예요.'), button('목록으로', 'secondary', () => { location.hash = '#/'; }))),
      );
      return;
    }
    this.setHeader(displayName(record), true, [
      iconButton('pencil', '편집', () => void this.editRecord(record)),
      iconButton('trash', '삭제', () => void this.deleteRecord(record)),
    ]);
    const dateNote = record.dateSource === 'file' ? ' (파일 날짜)' : record.dateSource === 'now' ? ' (가져온 날짜)' : '';
    const meta: Child[] = [];
    if (record.contact && record.number) meta.push(h('span', null, formatNumber(record.number)));
    meta.push(h('time', { datetime: new Date(record.date).toISOString() }, formatFull(record.date) + dateNote));
    if (record.durationSec) meta.push(h('span', null, formatDuration(record.durationSec)));
    meta.push(h('span', null, record.source === 'audio' ? '녹음에서 변환' : '텍스트로 추가'));
    this.main.replaceChildren(
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'record-head' }, h('div', { class: 'meta' }, meta), record.fileName ? h('div', { class: 'meta file' }, record.fileName) : null),
        h('div', { class: 'actions' }, button('복사', 'secondary', () => void this.copy(record), 'copy'), button('ChatGPT로 보내기', 'primary', () => void this.shareRecord(record), 'send')),
        h('div', { class: 'transcript' }, this.paragraphs(record)),
      ),
    );
    this.main.scrollTop = 0;
    this.main.querySelector('.transcript mark')?.scrollIntoView({ block: 'center' });
  }

  private paragraphs(record: CallRecord): HTMLElement[] {
    const terms = queryTerms(this.query);
    const paint = (text: string): Node[] => {
      if (terms.length === 0) return [document.createTextNode(text)];
      const body = normalizeForSearch(text);
      return marked(highlight(text, mergeRanges(terms.flatMap((term) => findRanges(body, term)))));
    };
    if (record.segments && record.segments.length > 0) {
      return record.segments.map((s) => h('p', null, h('span', { class: 'ts' }, formatClock(s.start)), paint(s.text)));
    }
    return record.text
      .split(/\n+/)
      .filter((line) => line.trim() !== '')
      .map((line) => h('p', null, paint(line)));
  }

  private async copy(record: CallRecord): Promise<void> {
    try {
      await navigator.clipboard.writeText(record.text);
      toast('내용을 복사했어요.');
    } catch {
      toast('복사하지 못했어요.');
    }
  }

  private async shareRecord(record: CallRecord): Promise<void> {
    if (!(await this.store.getSetting<boolean>('shareNoticeSeen'))) {
      const ok = await confirmSheet(
        'ChatGPT로 보내기',
        '이 통화의 글이 휴대폰의 공유 화면으로 넘어가요. ChatGPT 앱을 고르면 이 글이 휴대폰 밖(OpenAI)으로 전송돼요.',
        '계속',
      );
      if (!ok) return;
      await this.store.setSetting('shareNoticeSeen', true);
    }
    await shareText('통화 기록', recordShareText(record));
  }

  private recordForm(initial: { contact: string; number: string; date: number; text: string }, textFirst: boolean) {
    const contact = h('input', { name: 'contact', autocomplete: 'off', placeholder: '예: 김민준', value: initial.contact });
    const number = h('input', { name: 'number', inputmode: 'tel', autocomplete: 'off', placeholder: '예: 010-1234-5678', value: initial.number ? formatNumber(initial.number) : '' });
    const when = h('input', { name: 'when', type: 'datetime-local', required: true, value: toLocalInput(initial.date) });
    const text = h('textarea', { name: 'text', required: true, placeholder: '에이닷에서 복사한 통화 내용을 붙여 넣으세요.' });
    text.value = initial.text;
    const fields = [field('상대 이름', contact), field('전화번호', number), field('통화 일시', when)];
    const body = h('div', { class: 'form' }, textFirst ? [field('내용', text), fields] : [fields, field('내용', text)]);
    return { body, contact, number, when, text };
  }

  private async addTextDialog(prefill: { text?: string; title?: string } = {}): Promise<boolean> {
    const lead = prefill.title && !(prefill.text ?? '').includes(prefill.title) ? prefill.title : '';
    const form = this.recordForm({ contact: '', number: '', date: Date.now(), text: [lead, prefill.text ?? ''].filter(Boolean).join('\n\n') }, true);
    const { value } = await openSheet('텍스트로 기록 추가', [form.body], [
      { label: '취소', value: 'cancel' },
      { label: '저장', value: 'save', variant: 'primary' },
    ]);
    if (value !== 'save') return false;
    const date = fromLocalInput(form.when.value);
    const record = await this.store.addRecord({
      source: 'text',
      contact: form.contact.value,
      number: normalizeNumber(form.number.value),
      date: Number.isFinite(date) ? date : Date.now(),
      dateSource: 'manual',
      text: form.text.value,
      engine: 'text',
    });
    this.upsert(record);
    toast('기록을 추가했어요.');
    return true;
  }

  private async reviewSharedText(item: InboxItem): Promise<void> {
    await this.addTextDialog({ text: item.text, title: item.title });
  }

  private async editRecord(record: CallRecord): Promise<void> {
    const form = this.recordForm(record, false);
    const { value } = await openSheet('통화 기록 편집', [form.body], [
      { label: '취소', value: 'cancel' },
      { label: '저장', value: 'save', variant: 'primary' },
    ]);
    if (value !== 'save') return;
    const patch: RecordPatch = { contact: form.contact.value, number: normalizeNumber(form.number.value), text: form.text.value };
    if (form.when.value !== toLocalInput(record.date)) {
      const date = fromLocalInput(form.when.value);
      if (Number.isFinite(date)) {
        patch.date = date;
        patch.dateSource = 'manual';
      }
    }
    const updated = await this.store.updateRecord(record.id, patch);
    this.upsert(updated, false);
    this.render();
    toast('저장했어요.');
  }

  private async deleteRecord(record: CallRecord): Promise<void> {
    const ok = await confirmSheet('기록 삭제', `${displayName(record)} 통화 기록을 지울까요? 되돌릴 수 없어요.`, '삭제', true);
    if (!ok) return;
    await this.store.deleteRecord(record.id);
    this.forget(record.id);
    location.hash = '#/';
    toast('삭제했어요.');
  }

  private showImport(): void {
    this.setHeader('가져오기', true);
    this.renderQueue();
    this.main.scrollTop = 0;
  }

  private queueChanged(): void {
    this.updateBanner();
    if (this.route.name !== 'import' || this.queueQueued) return;
    this.queueQueued = true;
    requestAnimationFrame(() => {
      this.queueQueued = false;
      if (this.route.name === 'import') this.renderQueue();
    });
  }

  private updateBanner(): void {
    const active = [...this.importer.entries.values()].filter((e) => e.stage === 'queued' || e.stage === 'transcribing' || e.stage === 'saving');
    this.importBanner.hidden = active.length === 0;
    if (active.length === 0) return;
    if (!this.importer.busy) {
      this.importBanner.replaceChildren(icon('file-music', 22), h('div', null, h('strong', null, `가져오지 않은 항목 ${active.length}개`), h('p', null, '눌러서 이어서 가져오기')));
      return;
    }
    const current = active.find((e) => e.stage !== 'queued');
    this.importBanner.replaceChildren(
      icon('loader-2', 22),
      h('div', null, h('strong', null, `${active.length}개를 가져오는 중`), h('p', null, current ? `${current.name}: ${current.detail}` : '차례를 기다리는 중')),
    );
    this.importBanner.querySelector('.icon')?.classList.add('spin');
  }

  private renderQueue(): void {
    const entries = [...this.importer.entries.values()];
    const waiting = entries.some((e) => e.stage === 'queued') && !this.importer.busy;
    this.main.replaceChildren(
      h(
        'div',
        { class: 'page' },
        h(
          'div',
          { class: 'section' },
          h('div', { class: 'actions' }, button('녹음 가져오기', 'primary', () => this.pickAudio(), 'file-music'), button('텍스트 붙여넣기', 'secondary', () => void this.addTextDialog(), 'file-text')),
          h('p', { class: 'muted' }, '녹음은 이 휴대폰 안에서 글로 바뀌고, 다 바뀌면 앱에 받아 둔 녹음 사본은 바로 지워져요. 원래 녹음 파일은 내 파일 앱에 그대로 있어요.'),
          waiting ? button('가져오기 시작', 'primary', () => void this.importer.run(), 'player-play') : null,
        ),
        entries.length === 0
          ? h('div', { class: 'empty' }, icon('file-music', 40), h('h2', null, '가져오는 중인 항목이 없어요'), h('p', null, '여러 녹음을 한 번에 골라도 돼요. 하나씩 차례로 글로 바꿔요.'))
          : h('ul', { class: 'queue' }, entries.map((entry) => this.queueRow(entry))),
      ),
    );
  }

  private queueRow(entry: QueueEntry): HTMLElement {
    const pct = Math.round(entry.progress * 100);
    const stage = { queued: '대기', transcribing: `${pct}%`, saving: '저장 중', done: '완료', error: '실패' }[entry.stage];
    const fill = h('div', { class: 'fill' });
    fill.style.setProperty('--p', String(entry.progress));
    const working = entry.stage === 'queued' || entry.stage === 'transcribing' || entry.stage === 'saving';
    return h(
      'li',
      { class: `progress ${entry.stage}` },
      h('div', { class: 'progress-head' }, icon(entry.kind === 'audio' ? 'file-music' : 'file-text', 20), h('span', { class: 'name' }, entry.name), h('span', { class: 'stage' }, stage)),
      working ? h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${entry.name} 진행률`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, fill) : null,
      h('p', { class: 'detail' }, entry.detail),
      entry.stage === 'error'
        ? h('div', { class: 'actions' }, button('다시 시도', 'secondary', () => void this.importer.retry(entry.id), 'refresh'), button('목록에서 빼기', 'ghost', () => void this.importer.remove(entry.id)))
        : null,
      entry.stage === 'done' && entry.recordId ? h('a', { class: 'btn btn-ghost', href: `#/r/${encodeURIComponent(entry.recordId)}` }, '기록 보기') : null,
    );
  }

  private async showSettings(): Promise<void> {
    this.setHeader('설정', false);
    const storage = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '계산하는 중'));
    const backupInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    backupInput.addEventListener('change', () => void this.importBackup(backupInput));
    this.main.replaceChildren(
      h(
        'div',
        { class: 'page' },
        h('section', { class: 'section' }, h('h2', null, '음성 인식'), this.speechPanel()),
        h('section', { class: 'section' }, h('h2', null, 'AI 검색과 물어보기'), this.aiPanel()),
        h('section', { class: 'section' }, h('h2', null, '저장 공간'), h('div', { class: 'panel' }, storage)),
        h(
          'section',
          { class: 'section' },
          h('h2', null, '백업'),
          h(
            'div',
            { class: 'panel' },
            h('p', null, '통화 기록을 JSON 파일 하나로 내보내거나 다시 가져와요. 같은 기록이 양쪽에 있으면 더 나중에 고친 쪽이 남아요.'),
            h('div', { class: 'actions' }, button('백업 내보내기', 'secondary', () => this.exportBackup(), 'download'), button('백업 가져오기', 'secondary', () => { backupInput.value = ''; backupInput.click(); }, 'upload')),
            backupInput,
          ),
        ),
        h(
          'section',
          { class: 'section' },
          h('h2', null, '개인정보'),
          h(
            'div',
            { class: 'panel' },
            h('p', null, '녹음과 통화 글은 이 휴대폰의 앱 저장소에만 있어요. 앱이 인터넷을 쓰는 때는 앱 파일(sun1408.github.io)과 모델 파일(huggingface.co)을 처음 받을 때뿐이고, 그 밖의 주소로는 보안 정책이 연결을 막아요.'),
            h('a', { href: 'https://github.com/sun1408/call-search#readme', target: '_blank', rel: 'noopener noreferrer' }, '무엇을 어디서 받는지 보기'),
          ),
        ),
        h(
          'section',
          { class: 'section' },
          h('h2', null, '모두 지우기'),
          h('div', { class: 'panel' }, h('p', null, '이 휴대폰에 저장된 통화 기록과 가져오는 중인 항목을 모두 지워요. 내려받은 모델은 위의 음성 인식에서 따로 지울 수 있어요.'), h('div', { class: 'actions' }, button('모든 기록 지우기', 'danger', () => void this.deleteAll(), 'trash'))),
        ),
        h('p', { class: 'muted version' }, `버전 ${__VERSION__}`),
      ),
    );
    this.main.scrollTop = 0;
    await this.fillStorage(storage);
  }

  private async askModelDownload(pack: ModelPack): Promise<boolean> {
    const size = formatBytes(packBytes(pack));
    const { value } = await openSheet(
      '음성 인식 모델 내려받기',
      [
        h('p', null, `녹음을 글로 바꾸려면 음성 인식 모델(${pack.name}, 약 ${size})을 한 번 내려받아야 해요. 한 번 받으면 이 휴대폰에 저장돼서 다시 받지 않아요.`),
        h(
          'div',
          { class: 'notice' },
          icon('shield-lock', 22),
          h('div', null, h('strong', null, '녹음은 휴대폰 밖으로 나가지 않아요'), h('p', null, '모델 파일만 huggingface.co에서 받고, 녹음을 글로 바꾸는 일은 모두 이 휴대폰 안에서 해요.')),
        ),
        h('p', null, '모바일 데이터보다 Wi-Fi에서 받는 것을 권해요.'),
      ],
      [
        { label: '나중에', value: 'cancel' },
        { label: `내려받기 (${size})`, value: 'ok', variant: 'primary' },
      ],
    );
    return value === 'ok';
  }

  private async askWhisperDownload(label: string, bytes: number): Promise<boolean> {
    const size = formatBytes(bytes);
    const { value } = await openSheet(
      'Whisper 모델 내려받기',
      [
        h('p', null, `Whisper로 글로 바꾸려면 ${label} 모델(약 ${size})을 한 번 내려받아야 해요. 크기가 커서 Wi-Fi에서 받기를 권해요.`),
        h('p', null, '모델은 huggingface.co에서 받고, 녹음은 이 휴대폰 안에서만 글로 바꿔요.'),
      ],
      [
        { label: '나중에', value: 'cancel' },
        { label: `내려받기 (${size})`, value: 'ok', variant: 'primary' },
      ],
    );
    return value === 'ok';
  }

  private engineChooser(): HTMLElement {
    const whisper = whisperModel().model;
    const whisperOption = h('option', { value: 'whisper' }, `${whisper.label} (더 정확할 수 있음, 약 ${formatBytes(whisper.bytes)})`);
    const select = h('select', { 'aria-label': '음성 인식 엔진' }, h('option', { value: 'sensevoice' }, `SenseVoice Small (기본, 약 ${formatBytes(packBytes(this.transcriber.pack))})`), whisperOption);
    const note = h('p', { class: 'muted engine-note' }, '확인하는 중');
    select.addEventListener('change', () => {
      void this.store.setSetting('asrEngine', select.value).then(() => toast(select.value === 'whisper' ? '다음 녹음부터 Whisper로 글로 바꿔요.' : '다음 녹음부터 SenseVoice로 글로 바꿔요.'));
    });
    void (async () => {
      const support = await this.whisper.available();
      let engine = await this.engines.engine();
      whisperOption.disabled = !support.ok;
      if (!support.ok && engine === 'whisper') {
        engine = 'sensevoice';
        await this.store.setSetting('asrEngine', engine);
      }
      select.value = engine;
      note.textContent = support.ok
        ? 'Whisper는 더 정확할 수 있지만 모델이 크고 GPU(WebGPU)를 써요. 긴 통화는 SenseVoice가 더 빨라요.'
        : `Whisper는 고를 수 없어요: ${support.reason}`;
    })();
    return h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', null, '엔진'), select), note);
  }

  private speechPanel(): HTMLElement {
    const pack = this.transcriber.pack;
    const status = h('p', null, '확인하는 중');
    const fill = h('div', { class: 'fill' });
    const bar = h('div', { class: 'bar', hidden: true, role: 'progressbar', 'aria-label': '모델 내려받기 진행률' }, fill);
    const actions = h('div', { class: 'actions' });
    const refresh = async (): Promise<void> => {
      const cached = await isPackCached(pack);
      status.textContent = cached
        ? '모델을 내려받았어요. 인터넷 없이도 녹음을 글로 바꿀 수 있어요.'
        : '아직 모델을 받지 않았어요. 처음 녹음을 가져올 때 받거나 지금 받을 수 있어요.';
      actions.replaceChildren(cached ? button('모델 지우기', 'danger', () => void removeModel(), 'trash') : button('지금 내려받기', 'secondary', () => void download(), 'cloud-download'));
    };
    const download = async (): Promise<void> => {
      if (!(await this.askModelDownload(pack))) return;
      actions.replaceChildren();
      bar.hidden = false;
      try {
        await downloadPack(pack, (loaded, total) => {
          fill.style.setProperty('--p', String(loaded / total));
          status.textContent = `내려받는 중 ${formatBytes(loaded)} / ${formatBytes(total)}`;
        });
        toast('모델을 내려받았어요.');
      } catch (error) {
        toast(error instanceof Error ? error.message : '모델을 내려받지 못했어요.');
      }
      bar.hidden = true;
      await refresh();
    };
    const removeModel = async (): Promise<void> => {
      if (!(await confirmSheet('모델 지우기', '내려받은 음성 인식 모델을 지울까요? 다음에 녹음을 가져오면 다시 받아요.', '지우기', true))) return;
      this.transcriber.release();
      await removePack(pack);
      toast('모델을 지웠어요.');
      await refresh();
    };
    void refresh();
    return h(
      'div',
      { class: 'panel' },
      this.engineChooser(),
      h('strong', null, 'SenseVoice 모델'),
      h('div', { class: 'kv' }, h('span', null, '크기'), h('span', null, `약 ${formatBytes(packBytes(pack))}`)),
      h('div', { class: 'kv' }, h('span', null, '언어'), h('span', null, '한국어 (영어 섞인 말도 인식)')),
      status,
      bar,
      actions,
    );
  }

  private aiPanel(): HTMLElement {
    const searchStatus = h('p', null, '확인하는 중');
    const searchActions = h('div', { class: 'actions' });
    const chatStatus = h('p', null, '확인하는 중');
    const chatActions = h('div', { class: 'actions' });
    const modelSelect = h('select', { 'aria-label': 'AI 답변 모델' }, ...CHAT_MODELS.map((m) => h('option', { value: m.id }, `${m.label}, 약 ${formatBytes(m.bytes)}`)));
    modelSelect.addEventListener('change', () => {
      this.chat.stop();
      void this.store.setSetting('chatModel', modelSelect.value).then(() => this.aiPanelRefresh?.());
    });
    const refresh = async (): Promise<void> => {
      const enabled = await this.index.isEnabled();
      const s = this.index.status;
      searchStatus.textContent = !enabled
        ? '꺼져 있어요. 켜면 검색창과 물어보기가 뜻이 비슷한 통화도 찾아요.'
        : s.state === 'loading'
          ? `모델을 불러오는 중 ${Math.round((s.loaded / Math.max(1, s.total)) * 100)}%`
          : s.state === 'indexing'
            ? `통화를 AI 검색에 넣는 중 ${s.done}/${s.total}`
            : s.state === 'error'
              ? `문제가 생겼어요: ${s.message}`
              : s.state === 'ready'
                ? `켜져 있어요. 통화 조각 ${s.chunks}개를 뜻으로 찾을 수 있어요.`
                : '켜져 있어요.';
      searchActions.replaceChildren(
        enabled
          ? button('AI 검색 끄기', 'danger', () => void this.index.setEnabled(false).then(() => toast('AI 검색을 끄고 모델을 지웠어요.')), 'trash')
          : button('AI 검색 켜기', 'secondary', () => void this.enableSemantic(), 'sparkles'),
      );
      const model = chatModel(await this.store.getSetting<string>('chatModel'));
      modelSelect.value = model.id;
      const support = await this.chat.support();
      const cached = await isModelCached(model);
      const c = this.chat.status;
      chatStatus.textContent = !support.ok
        ? `${support.reason} 그래서 AI 답변은 만들 수 없고, 물어보면 관련 통화를 대신 보여 드려요.`
        : c.state === 'loading'
          ? `모델을 불러오는 중 ${Math.round((c.loaded / Math.max(1, c.total)) * 100)}%`
          : c.state === 'error'
            ? `문제가 생겼어요: ${c.message}`
            : cached
              ? '모델을 내려받았어요. 물어보기에서 바로 답해요.'
              : '아직 받지 않았어요. 처음 물어볼 때 받거나 지금 받을 수 있어요.';
      chatActions.replaceChildren(
        ...(support.ok && !cached && c.state !== 'loading' ? [button('지금 내려받기', 'secondary', () => void this.downloadChat(), 'cloud-download')] : []),
        ...(cached ? [button('모델 지우기', 'danger', () => void this.removeChat(), 'trash')] : []),
      );
    };
    this.aiPanelRefresh = () => void refresh();
    void refresh();
    return h(
      'div',
      { class: 'panel' },
      h('strong', null, 'AI 검색 (뜻으로 찾기)'),
      h('div', { class: 'kv' }, h('span', null, '모델'), h('span', null, `${EMBEDDING_MODEL.label}, 약 ${formatBytes(EMBEDDING_MODEL.bytes)}`)),
      searchStatus,
      searchActions,
      h('strong', null, '물어보기 답변 (WebGPU)'),
      h('label', { class: 'field' }, h('span', null, '모델'), modelSelect),
      chatStatus,
      chatActions,
      h('p', null, 'EXAONE은 LG AI연구원의 비상업 라이선스 모델이에요. 개인적으로 쓰는 데는 문제가 없어요.'),
    );
  }

  private async enableSemantic(): Promise<void> {
    if (!(await this.askEmbeddingDownload())) return;
    await this.index.setEnabled(true);
    try {
      await this.index.sync(this.records);
      toast('AI 검색을 켰어요.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'AI 검색을 켜지 못했어요.');
    }
  }

  private async downloadChat(): Promise<void> {
    const model = chatModel(await this.store.getSetting<string>('chatModel'));
    if (!(await this.askChatDownload(model.label, model.bytes))) return;
    await this.store.setSetting(`consent:${model.id}`, true);
    try {
      await this.chat.start(model);
      toast('AI 답변 모델을 준비했어요.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'AI 답변 모델을 받지 못했어요.');
    }
  }

  private async removeChat(): Promise<void> {
    const model = chatModel(await this.store.getSetting<string>('chatModel'));
    if (!(await confirmSheet('모델 지우기', `${model.label} 모델을 지울까요? 다시 쓰려면 다시 받아야 해요.`, '지우기', true))) return;
    this.chat.stop();
    await deleteCachedModel(model);
    await this.store.setSetting(`consent:${model.id}`, false);
    toast('AI 답변 모델을 지웠어요.');
    this.aiPanelRefresh?.();
  }

  private async fillStorage(target: HTMLElement): Promise<void> {
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    const kv = (label: string, value: string) => h('div', { class: 'kv' }, h('span', null, label), h('span', null, value));
    target.replaceChildren(
      kv('통화 기록', `${this.records.length}건`),
      kv('사용 중인 공간', estimate?.usage !== undefined ? formatBytes(estimate.usage) : '알 수 없음'),
      kv('쓸 수 있는 공간', estimate?.quota !== undefined ? formatBytes(estimate.quota) : '알 수 없음'),
      kv('자동 삭제 방지', persisted ? '켜짐' : '꺼짐'),
    );
  }

  private exportBackup(): void {
    const blob = new Blob([JSON.stringify(makeBackup(this.records, new Date()))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const link = h('a', { href: url, download: `call-search-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast(`${this.records.length}건을 내보냈어요.`);
  }

  private async importBackup(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      const plan = planMerge(this.records, parsed.records);
      await this.store.putRecords(plan.toPut);
      for (const record of plan.toPut) this.upsert(record, false);
      const skipped = parsed.rejected > 0 ? `, ${parsed.rejected}건은 읽지 못했어요` : '';
      toast(`${plan.added}건 추가, ${plan.updated}건 갱신${skipped}.`);
      if (this.route.name === 'settings') void this.showSettings();
    } catch (error) {
      if (error instanceof BackupError) toast(error.message);
      else if (error instanceof SyntaxError) toast('JSON 파일을 읽지 못했어요.');
      else toast('백업을 가져오지 못했어요.');
    }
  }

  private async deleteAll(): Promise<void> {
    const ok = await confirmSheet('모든 기록 지우기', `통화 기록 ${this.records.length}건을 모두 지울까요? 되돌릴 수 없어요.`, '모두 지우기', true);
    if (!ok) return;
    await this.store.clearAll();
    this.records = [];
    this.docs.clear();
    this.index.chunks = [];
    this.scheduleIndexSync();
    this.importer.entries.clear();
    this.updateBanner();
    toast('모두 지웠어요.');
    if (this.route.name === 'settings') void this.showSettings();
  }
}
