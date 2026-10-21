import { chunkText } from '../core/chunking';
import { displayName, formatShortDateTime, formatWhen } from '../core/format';
import { buildMessages, buildSources, chatgptShareText, citedSources, retrievalQuery, stripThinking, type ChatMessage, type Source } from '../core/prompt';
import { parseQueryHints } from '../core/query-hints';
import { retrieve, type Scored } from '../core/retrieval';
import { listPeople } from '../core/search';
import type { Store } from '../core/store';
import type { CallRecord, Chunk } from '../core/types';
import { chatModel, type ChatEngine, type SemanticIndex } from './ai';
import { h, icon } from './dom';
import { openSheet, toast } from './ui';

type TurnState = 'searching' | 'loading' | 'answering' | 'done' | 'fallback' | 'error';

interface Turn {
  question: string;
  state: TurnState;
  answer: string;
  note: string;
  sources: Source[];
  scored: Scored[];
}

export interface AskContext {
  store: Store;
  index: SemanticIndex;
  chat: ChatEngine;
  records(): CallRecord[];
  share(title: string, text: string): Promise<void>;
  askEmbeddingDownload(): Promise<boolean>;
  askChatDownload(label: string, bytes: number): Promise<boolean>;
}

const EXAMPLES = ['김과장이 지난주에 뭐라고 했지?', '계약서 언제까지 보내기로 했지?', '어제 통화에서 약속 장소 어디였어?'];

export class AskView {
  private readonly turns: Turn[] = [];
  private busy = false;
  private renderQueued = false;
  private readonly log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  private readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  readonly root: HTMLElement;

  constructor(private readonly ctx: AskContext) {
    this.input = h('textarea', { rows: 1, placeholder: '통화 내용에 대해 물어보세요', 'aria-label': '질문', enterkeyhint: 'send' });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.send = h('button', { class: 'icon-btn send', type: 'button', 'aria-label': '보내기', onclick: () => void this.submit() }, icon('send', 22));
    this.root = h('div', { class: 'ask' }, h('div', { class: 'page' }, this.log), h('div', { class: 'composer' }, this.input, this.send));
  }

  clear(): void {
    if (this.busy) this.ctx.chat.interrupt();
    this.turns.length = 0;
    this.render();
  }

  render(): void {
    this.log.replaceChildren(...(this.turns.length === 0 ? [this.intro()] : this.turns.map((turn) => this.turnView(turn))));
    this.send.disabled = this.busy;
  }

  scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private intro(): HTMLElement {
    return h(
      'div',
      { class: 'empty' },
      icon('message-chatbot', 40),
      h('h2', null, '통화 내용에 대해 물어보세요'),
      h('p', null, '질문과 비슷한 통화를 휴대폰 안에서 찾아 답하고, 어느 통화에서 나온 말인지 알려 드려요. 이어서 물어보면 앞의 대화를 기억해요.'),
      h('div', { class: 'actions examples' }, EXAMPLES.map((q) => h('button', { class: 'chip', type: 'button', onclick: () => this.ask(q) }, q))),
    );
  }

  private sourceChip(source: Source): HTMLElement {
    return h('a', { class: 'chip source', href: `#/r/${encodeURIComponent(source.recordId)}` }, icon('file-text', 16), `[${source.n}] ${source.who} · ${source.when}`);
  }

  private turnView(turn: Turn): HTMLElement {
    const cited = citedSources(turn.answer, turn.sources);
    const shown = cited.length > 0 ? cited : turn.sources;
    const status: Record<TurnState, string> = {
      searching: '관련 통화를 찾는 중',
      loading: this.loadingLabel(),
      answering: '',
      done: '',
      fallback: '',
      error: '',
    };
    return h(
      'section',
      { class: 'turn' },
      h('p', { class: 'bubble' }, turn.question),
      h(
        'div',
        { class: 'answer' },
        status[turn.state] ? h('p', { class: 'muted working' }, icon('loader-2', 18), status[turn.state]) : null,
        turn.answer ? h('p', { class: 'answer-text' }, stripThinking(turn.answer)) : null,
        turn.note ? h('div', { class: `notice ${turn.state === 'error' ? 'error' : ''}` }, icon('info-circle', 22), h('div', null, h('p', null, turn.note))) : null,
        turn.state === 'fallback' && turn.scored.length > 0 ? h('ul', { class: 'rows' }, this.fallbackRows(turn)) : null,
        turn.state !== 'searching' && shown.length > 0 && turn.state !== 'fallback'
          ? h('div', { class: 'sources' }, h('span', { class: 'muted' }, cited.length > 0 ? '답에 쓴 통화' : '찾은 통화'), shown.map((s) => this.sourceChip(s)))
          : null,
        turn.state === 'done' || turn.state === 'fallback'
          ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => void this.askChatGpt(turn) }, icon('external-link', 20), 'ChatGPT에 물어보기'))
          : null,
      ),
    );
  }

  private loadingLabel(): string {
    const s = this.ctx.chat.status;
    if (s.state === 'loading') return `AI 답변 모델을 불러오는 중 ${Math.round((s.loaded / Math.max(1, s.total)) * 100)}%`;
    const index = this.ctx.index.status;
    if (index.state === 'loading') return `AI 검색 모델을 불러오는 중 ${Math.round((index.loaded / Math.max(1, index.total)) * 100)}%`;
    if (index.state === 'indexing') return `통화를 AI 검색에 넣는 중 ${index.done}/${index.total}`;
    return '준비하는 중';
  }

  private fallbackRows(turn: Turn): HTMLElement[] {
    const seen = new Set<string>();
    const rows: HTMLElement[] = [];
    for (const s of turn.scored) {
      if (seen.has(s.record.id)) continue;
      seen.add(s.record.id);
      rows.push(
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
      );
    }
    return rows;
  }

  private async askChatGpt(turn: Turn): Promise<void> {
    const text = chatgptShareText(turn.question, turn.sources);
    const { value } = await openSheet(
      'ChatGPT에 물어보기',
      [
        h('p', null, `이 질문과 찾은 발췌 ${turn.sources.length}개만 ChatGPT 앱으로 넘어가요. 보내면 이 글은 휴대폰 밖(OpenAI)으로 전송돼요. 통화 전체 내용은 보내지 않아요.`),
        h('pre', { class: 'share-preview' }, text),
      ],
      [
        { label: '취소', value: 'cancel' },
        { label: '보내기', value: 'ok', variant: 'primary' },
      ],
    );
    if (value === 'ok') await this.ctx.share('통화 검색 질문', text);
  }

  private async submit(): Promise<void> {
    const question = this.input.value.trim();
    if (!question || this.busy) return;
    this.input.value = '';
    await this.ask(question);
  }

  private history(): ChatMessage[] {
    return this.turns
      .filter((t) => t.state === 'done' && t.answer)
      .flatMap((t) => [
        { role: 'user' as const, content: t.question },
        { role: 'assistant' as const, content: stripThinking(t.answer) },
      ]);
  }

  private keywordChunks(records: CallRecord[]): Chunk[] {
    return records.flatMap((record) =>
      chunkText(record.text).map((p) => ({ id: `${record.id}:${p.index}`, recordId: record.id, index: p.index, start: p.start, end: p.end, text: p.text, model: 'keyword', vector: new Float32Array(0) })),
    );
  }

  async ask(question: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const history = this.history();
    const turn: Turn = { question, state: 'searching', answer: '', note: '', sources: [], scored: [] };
    this.turns.push(turn);
    this.render();
    try {
      const records = this.ctx.records();
      if (records.length === 0) {
        turn.state = 'fallback';
        turn.note = '아직 통화 기록이 없어요. 녹음이나 텍스트를 먼저 가져와 주세요.';
        return;
      }
      const byId = new Map(records.map((r) => [r.id, r]));
      const query = retrievalQuery(question, history);
      const hints = parseQueryHints(question, listPeople(records).map((p) => p.key), new Date());
      let semantic = await this.ctx.index.isEnabled();
      if (!semantic && (await this.ctx.askEmbeddingDownload())) {
        await this.ctx.index.setEnabled(true);
        semantic = true;
      }
      let vector: Float32Array | null = null;
      if (semantic) {
        turn.state = 'loading';
        this.render();
        await this.ctx.index.sync(records);
        vector = await this.ctx.index.queryVector(query);
      }
      const chunks = semantic ? this.ctx.index.chunks : this.keywordChunks(records);
      turn.scored = retrieve(vector, query, chunks, byId, hints, { topK: 6, perRecord: 2 });
      turn.sources = buildSources(turn.scored, (s) => displayName(s.record), (s) => formatShortDateTime(s.record.date));
      if (turn.sources.length === 0) {
        turn.state = 'fallback';
        turn.note = '질문과 관련된 통화를 찾지 못했어요. 다른 말로 물어보세요.';
        return;
      }
      const support = await this.ctx.chat.support();
      if (!support.ok) {
        turn.state = 'fallback';
        turn.note = `${support.reason} 그래서 AI 답변 대신 질문과 관련 있어 보이는 통화를 보여 드려요.`;
        return;
      }
      const model = chatModel(await this.ctx.store.getSetting<string>('chatModel'));
      if (!(await this.ctx.store.getSetting<boolean>(`consent:${model.id}`))) {
        if (!(await this.ctx.askChatDownload(model.label, model.bytes))) {
          turn.state = 'fallback';
          turn.note = 'AI 답변 모델을 받지 않아서 관련 통화만 보여 드려요. 설정에서 언제든 받을 수 있어요.';
          return;
        }
        await this.ctx.store.setSetting(`consent:${model.id}`, true);
      }
      turn.state = 'loading';
      this.render();
      await this.ctx.chat.start(model);
      turn.state = 'answering';
      this.render();
      const text = await this.ctx.chat.generate(buildMessages(question, turn.sources, history), (piece) => {
        turn.answer += piece;
        this.scheduleRender();
      });
      turn.answer = stripThinking(text) || stripThinking(turn.answer);
      turn.state = 'done';
    } catch (error) {
      turn.state = turn.sources.length > 0 ? 'fallback' : 'error';
      turn.note = `AI 답변을 만들지 못했어요 (${error instanceof Error ? error.message : String(error)}). ${turn.sources.length > 0 ? '대신 관련 통화를 보여 드려요.' : ''}`;
      toast('AI 답변을 만들지 못했어요.');
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
