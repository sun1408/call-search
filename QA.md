# QA note

End-to-end checks run on the build server (1 vCPU arm64, about 2 GB free memory) in headless Chrome for Testing 149 through `scripts/e2e.mjs` (playwright-core 1.58.2). Every browser and model run went through `dori heavy` so it waited for a free slot on the shared host. The script serves `docs/` locally (or takes `--base` for the live site), uses a fresh browser profile and deletes it afterwards.

```sh
node scripts/e2e.mjs --suite core            # keyword search, records, backup, share target, CSP, offline
node scripts/e2e.mjs --suite asr             # real SenseVoice pipeline on test_wavs/ko.wav
node scripts/e2e.mjs --suite long            # synthetic 30-minute call
node scripts/e2e.mjs --suite ai              # real multilingual-e5-small, 물어보기 without WebGPU, ChatGPT share text
node scripts/e2e.mjs --suite whisper         # Whisper option gating, Whisper code path with whisper-base on WASM
```

## Live site run

On 2026-10-21 the `core`, `asr`, `ai` and `whisper` suites ran against https://sun1408.github.io/call-search/ (commit 64d23e7, service worker cache `cs-shell-0e0b6de9aee1`) and all passed: core 9 s, asr 104 s, ai 57 s, whisper 67 s. The 30-minute `long` suite was not repeated there, to keep load off the shared server. Hosts contacted: only `sun1408.github.io`, `huggingface.co` and `us.aws.cdn.hf.co`.

## On-device transcription (SenseVoice, `asr` suite)

Sample: `test_wavs/ko.wav` from `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` (4.6 s, 16 kHz), imported through the 녹음 가져오기 button as `01012345678_20261020051500.wav`.

| Step | Local build | Live site |
|---|---|---|
| Size notice shown before anything is fetched | 약 252 MB | 약 252 MB |
| Model download into Cache Storage (huggingface.co, 239 MB + tokens) | 44 s | 45 s |
| Speech engine start (wasm + model into memory) | 5.4 to 8.5 s | 10.6 to 11.5 s |
| Transcribing the 4.6 s sample | 3.1 to 5.0 s | 7.6 to 13.1 s |
| First import, from button press to saved record | 58 s | 65 s |

Each column is one run on this shared single-CPU host, whose load was not measured during the runs, so the times vary between runs.

Output text (stored and shown as recognized, spacing as SenseVoice emits it):

```
조 금만 생각 을 하 면서 살 면 훨씬 편할 거야.
```

The reference transcript is "조금만 생각을 하면서 살면 훨씬 편할 거야." SenseVoice-Small puts word boundaries inside some Korean words; the raw JSON from sherpa-onnx carries the same tokens (`"조"," 금","만"," 생각"," ","을", ...`). Search ignores spaces, so searching 조금만 or 하면서 finds this call and highlights `조 금만` (checked in this suite too). Before embedding, particles that SenseVoice splits off (`생각 을`) are joined back; the stored and displayed text stays as recognized.

Also checked in the same run:

- The file name's UTC stamp `20261020051500` shows as 2026년 10월 20일 (화) 오후 2:15 (KST); the number becomes the title `010-1234-5678`.
- A second import with every Hugging Face host blocked works from the cached model, without a second download notice.
- After an offline reload the cached engine still transcribes.
- A fetch to example.com from inside the speech worker is blocked by the CSP header the service worker attaches.

## Long call (`long` suite)

A synthetic 30-minute call (the ko.wav sentence at the start of every minute, low noise in between) encoded as mp3, 10.8 MB.

| Measure | Result |
|---|---|
| Total time from import to saved record | 119 s (transcription 110 s for 1800 s of audio) |
| Progress updates seen | 54, never going backwards |
| Segments in the record | 30, duration shown as 30분 |
| Peak memory of all Chrome processes | 1.9 GB |

AAC: this server's headless Chrome for Testing cannot decode m4a/AAC at all (`decodeAudioData` gives `EncodingError` even for a 4.6 s file), while mp3 and ogg decode, so the long call used mp3. Chrome on Android decodes AAC, which is what 에이닷 records; the m4a path is the same `decodeAudioData` call and is part of 석's phone test.

## Records, search, sharing and offline (`core` suite)

Passed on the local build and on https://sun1408.github.io/call-search/ at 412 x 915:

- Chrome's own checks (`Page.getInstallabilityErrors`, `Page.getAppManifest`) report no installability or manifest errors
- three text records listed newest first; searching 계약서 finds `계약서` and `계약 서` with highlighted snippets; contact and date filters narrow the list
- the record view shows the full transcript; edit, copy (clipboard), ChatGPT로 보내기 (Web Share payload), delete
- JSON export, delete all, JSON import restores both records
- a multipart POST to `share-target` with text and an audio file is answered by the service worker with 303 to `?share=1#/import`, opens the shared text for review and queues the audio; the shared audio first shows the model size notice
- a page fetch to example.com is blocked by the CSP
- offline reload shows the app and keyword search still works; a failed import waits behind a banner instead of taking over the start screen
- no uncaught page errors; light, dark and desktop screenshots checked

## AI search and 물어보기 (`ai` suite)

WebGPU is removed from the page in this run (`navigator.gpu` deleted) so the no-WebGPU path is exercised; the embedding model is real.

- Turning AI search on shows a size notice (multilingual-e5-small, 약 135 MB, huggingface.co) before any download.
- Download plus embedding the three test calls: 37 s locally, 46 s on the live site.
- Searching 미팅 날짜 변경 (no word in common with any call) shows under 뜻이 비슷한 통화, first: "회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다."
- 물어보기 "김과장이 회의를 언제로 옮기자고 했어?" with no WebGPU: the answer explains "이 브라우저에서는 WebGPU를 쓸 수 없어요. 그래서 AI 답변 대신 질문과 관련 있어 보이는 통화를 보여 드려요." and lists only 김과장's calls, the schedule change first; tapping it opens that call.
- ChatGPT에 물어보기 shows a notice that the text leaves the phone and a preview, then shares exactly this (the unrelated 이대리 call is not in it):

```
아래는 내 통화 기록에서 찾은 발췌야. 이 발췌만 보고 질문에 답해 줘. 답에 쓴 발췌는 [번호]로 알려 줘.

질문: 김과장이 회의를 언제로 옮기자고 했어?

[1] 김과장 · 10월 20일 오후 6:10
회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.

[2] 김과장 · 10월 14일 오후 2:03
내일 오후 세 시에 계약서 들고 사무실로 오세요. 주차는 지하 2층에 하시면 됩니다.
```

A regression this suite caught: removing every space between Hangul syllables before embedding pushed the right call from first to last for the paraphrase query, so embeddings now keep natural spacing and only re-join particles that SenseVoice splits off; keyword search stays fully space-insensitive.

## Optional Whisper engine (`whisper` suite)

- With no WebGPU the 설정 > 음성 인식 항목의 Whisper option is disabled and says why: "Whisper는 고를 수 없어요: 이 브라우저에서는 WebGPU를 쓸 수 없어요."
- The same Whisper code path (Transformers.js `automatic-speech-recognition`, audio cut into windows of at most 28 s at quiet points) was run with the documented test override `localStorage['cs.whisperModel']` = `onnx-community/whisper-base` (q8, 77 MB) on WASM, since this server has no GPU. On ko.wav it loaded in 33 s, transcribed in 21 s and wrote (the live site took 62 s from the download button to the saved record, same text):

```
조금만 생각을 하면서 살면 훨씬 편할 거야.
```

On the phone the option uses `onnx-community/whisper-large-v3-turbo` (q4, about 765 MB) on WebGPU; that run is part of 석's phone test.

## Network hosts seen

Every run logs the hosts the browser contacted. Only these appeared: the app's own origin (127.0.0.1 locally, sun1408.github.io live), `huggingface.co` and `us.aws.cdn.hf.co` (Hugging Face's download CDN, covered by `*.hf.co`).

## Not run on this server

- Whisper large-v3-turbo on WebGPU (no GPU here; the code path ran with whisper-base on WASM, above).
- The on-device AI answer (EXAONE 3.5 2.4B or Qwen2.5 1.5B on WebGPU): the server has no GPU and the brief keeps the LLM download off this host. The prompt assembly, citation parsing, follow-up handling and retrieval ranking are unit-tested with a fake model; the real answer is 석's phone test.
- m4a/AAC decoding (see above).
