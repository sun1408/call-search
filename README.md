# 통화 검색

통화 녹음을 휴대폰 안에서 글로 바꾸고, 그 글을 검색하고, 통화 내용에 대해 물어볼 수 있는 설치형 웹앱(PWA)입니다. 무료이고 서버가 없으며, 녹음과 통화 내용은 휴대폰 밖으로 나가지 않습니다.

- 앱 주소: https://sun1408.github.io/call-search/
- 대상: 안드로이드 크롬 (갤럭시 S24+ 기준). 데스크톱 크롬에서도 열립니다.

## 쓰는 법

1. 크롬으로 앱 주소를 열고 메뉴에서 **홈 화면에 추가**(앱 설치)를 누릅니다. 설치한 뒤에는 인터넷 없이도 열립니다.
2. **녹음 가져오기**
   - 내 파일 앱의 `Recordings > TPhoneCallRecords`(에이닷 전화 녹음 폴더)에서 녹음을 길게 눌러 **공유 > 통화 검색**을 고릅니다. 여러 개를 한 번에 골라도 됩니다.
   - 또는 앱의 **녹음 가져오기** 버튼으로 녹음 파일 여러 개를 고릅니다.
   - 처음 한 번은 음성 인식 모델(약 252 MB)을 받는다는 안내가 나옵니다. 받은 뒤에는 휴대폰 안에서 글로 바꾸고, 진행률이 보입니다. 다 바꾸면 앱이 받아 둔 녹음 사본은 지우고 글과 정보만 남깁니다. 원래 녹음 파일은 내 파일 앱에 그대로 있습니다.
3. **텍스트 추가**: 에이닷에서 복사한 통화 글을 공유하거나 붙여 넣습니다.
4. **검색**: 낱말을 넣으면 모든 통화 글에서 바로 찾아 형광펜으로 표시합니다. 최신 통화가 먼저 나오고 상대와 날짜 범위로 좁힐 수 있습니다. 띄어쓰기와 번호의 하이픈은 무시합니다. AI 검색을 켜 두면 글자가 같지 않아도 **뜻이 비슷한 통화**를 아래에 보여 줍니다.
5. **물어보기**: "김과장이 지난주에 뭐라고 했지?"처럼 물으면 관련 통화를 찾아 휴대폰 안의 AI가 답하고, 답에 쓴 통화를 번호로 알려 줍니다. 번호를 누르면 그 통화가 열립니다. 이어서 물어보면 앞의 대화를 기억합니다.
6. 기록마다 **복사**, **ChatGPT로 보내기**, **편집**, **삭제**가 있습니다.
7. **설정**: 음성 인식 엔진(기본 SenseVoice, WebGPU가 되는 기기에서는 더 정확할 수 있는 Whisper large-v3-turbo도 선택), AI 검색과 답변 모델, 저장 공간, 백업 내보내기와 가져오기(JSON), 모두 지우기.

## 물어보기는 이렇게 동작합니다

1. 질문에서 사람 이름(연락처)과 날짜 표현(오늘, 어제, 지난주, 이번 달, 10월 14일 등)을 읽어 범위를 좁힙니다.
2. 통화 글을 문장 단위 조각으로 나눠 multilingual-e5-small 임베딩으로 저장해 두고, 질문과 뜻이 가까운 조각을 찾습니다 (낱말이 겹치면 점수를 더 줍니다).
3. 찾은 조각만 번호를 붙여 휴대폰의 AI 답변 모델(WebGPU)에 넘기고, 모델은 그 조각만 근거로 답하며 쓴 통화를 `[1]`처럼 표시합니다.
4. WebGPU가 없거나 메모리가 부족하거나 답변 모델을 받지 않았으면, 실패하는 대신 그 이유를 알려 주고 관련 통화 목록을 보여 줍니다.
5. **ChatGPT에 물어보기**는 질문마다 직접 눌러야 하며, 보내기 전에 휴대폰 밖으로 나갈 글(질문과 찾은 조각만, 통화 전체는 아님)을 그대로 보여 줍니다.

## 파일 이름에서 읽는 정보

녹음 파일 이름에서 상대 이름, 전화번호, 통화 시각을 읽습니다. 못 읽으면 파일 날짜를 쓰고, 모두 기록 화면에서 고칠 수 있습니다.

| 앱 | 파일 이름 예 | 시각 |
|---|---|---|
| 에이닷 / T전화 (`TPhoneCallRecords`) | `01012345678_20261020051500.m4a`, `김과장_01012345678_20261020051500.m4a` | UTC로 저장되어 있어 한국 시각으로 바꿔 보여 줍니다 |
| 삼성 전화 | `통화 녹음 홍길동_241015_093012.m4a` | 휴대폰 시각 |
| 기타 | `이름_241015_093012.m4a`, `... 2024-10-15 09-30-12 ...` | 휴대폰 시각 |

## 개인정보와 네트워크

- 통화 기록과 검색 색인은 휴대폰 브라우저의 IndexedDB에만 저장합니다. 앱 파일과 모델은 Cache Storage에 저장해 오프라인에서도 동작합니다.
- 분석 도구, 광고, 외부 글꼴, 외부 스크립트(CDN)가 없습니다. 라이브러리는 모두 이 사이트에서 직접 제공합니다.
- 보안 정책(Content-Security-Policy)의 `connect-src`는 이 사이트 자신과 모델 파일 주소만 허용합니다. 그 밖의 주소로 연결하려 하면 브라우저가 막습니다 (화면과 백그라운드 워커 모두). 정책은 `src/core/csp.ts` 한 곳에 있고, 빌드가 `index.html`에 넣고 서비스 워커가 HTML과 워커 스크립트 응답 헤더에 붙입니다.

  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co https://*.hf.co; ...
  ```

  `*.hf.co`는 Hugging Face가 큰 파일을 내려보내는 CDN 주소입니다 (예: `us.aws.cdn.hf.co`). 지역에 따라 앞부분이 바뀌어 와일드카드로 허용합니다.

- 앱이 내려받는 것 (모델은 모두 커밋을 고정해 받습니다):

  | 무엇 | 어디서 | 언제 | 크기 |
  |---|---|---|---|
  | 앱 파일 (HTML, JS, CSS, 아이콘) | `sun1408.github.io/call-search/` | 처음 열 때, 새 버전 | 약 150 KB |
  | 음성 인식 엔진: sherpa-onnx wasm, silero VAD | `sun1408.github.io/call-search/vendor/sherpa-onnx-9d5fc71/` (이 저장소에 포함) | 처음 녹음을 글로 바꿀 때 | 약 12.5 MB |
  | 음성 인식 모델: SenseVoice Small int8 | `huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` (커밋 `2365bae`) | 처음 녹음을 글로 바꿀 때, 안내 후 한 번 | 239 MB |
  | Transformers.js 4.3.1, ONNX Runtime Web wasm | `sun1408.github.io/call-search/vendor/transformers-4.3.1/` (이 저장소에 포함) | AI 검색을 켤 때 | 약 27.5 MB |
  | AI 검색 모델: multilingual-e5-small (q8) | `huggingface.co/Xenova/multilingual-e5-small` (커밋 `761b726`) | AI 검색을 켤 때, 안내 후 한 번 | 약 135 MB |
  | 선택 음성 인식 모델: Whisper large-v3-turbo (q4) | `huggingface.co/onnx-community/whisper-large-v3-turbo` (커밋 `360ebcd`) | 설정에서 Whisper를 고르고 처음 바꿀 때, 안내 후 한 번 (WebGPU가 되는 기기만) | 약 765 MB |
  | AI 답변 모델: EXAONE 3.5 2.4B Instruct (q4f16) 또는 Qwen2.5 1.5B Instruct (q4f16) | `huggingface.co/onnx-community/EXAONE-3.5-2.4B-Instruct` (커밋 `52dafcd`), `huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct` (커밋 `d54957e`) | 물어보기에서 처음 답할 때, 안내 후 한 번 (WebGPU가 되는 기기만) | 약 1.7 GB / 1.2 GB |

- **ChatGPT로 보내기**(기록 화면)와 **ChatGPT에 물어보기**(물어보기 화면)는 누를 때만 동작하며, 안내를 보여 준 뒤 휴대폰의 공유 화면으로 글을 넘깁니다. 거기서 ChatGPT 앱을 고르면 그 글은 OpenAI로 전송됩니다.

## 개발

```sh
bun install            # 개발 도구만 (typescript, fake-indexeddb, playwright-core)
bun test               # 순수 로직 테스트 (검색, 파일 이름, 저장소, 백업, 조각 나누기, 순위, 질문 해석, 프롬프트)
bun run typecheck
bun run build          # docs/ 에 정적 사이트 생성 (GitHub Pages가 main 브랜치의 docs/ 를 배포)
bun run serve          # http://localhost:8787/call-search/
bun run vendor         # vendor 파일을 다시 받아 sha256 확인
node scripts/e2e.mjs --suite core,asr,long,ai,whisper [--base https://sun1408.github.io/call-search/]
```

개발과 시험용으로 `localStorage['cs.whisperModel']`에 모델(JSON: `id`, `revision`, `dtype`, `bytes`, `device`)을 넣으면 Whisper 엔진이 그 모델을 쓰고, WebGPU가 없어도 고를 수 있습니다. E2E는 이것으로 작은 `whisper-base`를 WASM에서 돌려 Whisper 경로를 시험합니다.

- `src/core/`: 순수 로직 (검색, 파일 이름, IndexedDB 저장소, 백업, 조각 나누기, 검색 순위, 질문 해석, 프롬프트, CSP)
- `src/app/`: 화면 (바닐라 TypeScript, 프레임워크 없음)
- `src/workers/`: 음성 인식(sherpa-onnx, Whisper), 임베딩, AI 답변 워커
- `src/sw.ts`: 서비스 워커 (앱 셸 캐시, 공유 대상 처리, CSP 헤더)
- `public/`: `index.html`, `manifest.webmanifest`, 아이콘, CSS, vendor 파일
- 시험 결과: `QA.md`, 디자인 원칙: `DESIGN.md`

## 라이선스

코드는 MIT. 함께 제공하는 파일: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0), [silero-vad](https://github.com/snakers4/silero-vad) (MIT), [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0), [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT), [Tabler Icons](https://tabler.io/icons) (MIT). 모델은 각 저장소의 라이선스를 따릅니다. SenseVoice는 FunASR 모델 라이선스, multilingual-e5-small은 MIT, Qwen2.5는 Apache-2.0, EXAONE 3.5는 LG AI연구원의 비상업 라이선스(개인 사용)입니다.
