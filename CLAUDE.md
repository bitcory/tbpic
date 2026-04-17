# tbpic — 우리동네사진관

AI 사진 변환 웹앱. 카카오 로그인 → 사진 업로드 → 스타일 선택 → Gemini Nano Banana 2로 변환.

## 파일 구조

- `index.html` — SPA 단일 파일 (뷰 전환, STYLES 배열, Gemini 프록시 호출)
- `api/generate.js` — Vercel Serverless, Gemini API 프록시 (API 키 서버 보관, 쿼터 관리)
- `api/_db.js`, `api/auth/*`, `api/me.js`, `api/image.js`, `api/charge/*`, `api/admin/*` — DB/인증/과금/관리
- `mypage.html` — 마이페이지
- `styles/` — 스타일 카드/케이스 썸네일 이미지
- `styles/original-backup/` — 최적화 전 원본 백업 (커밋 대상 아님)

## 스타일 카드 추가 방법

`index.html`의 `const STYLES = [...]` 배열에 객체 삽입. 위치는 메인 카드 스크롤러 순서와 동일.

### 기본 (단일) 스타일

```js
{ id: 'xxx', tag: 'Xxx', title: '한글 제목',
  img: 'styles/xxx.jpg',
  mode: 'preset',                 // 'preset' | 'dual' | 'custom'
  prompt: `...프롬프트...` },
```

### 멀티 케이스 스타일 (한복/애니메이션/흑백처럼 여러 변형)

```js
{ id: 'xxx', tag: 'Xxx', title: '한글 제목',
  img: 'styles/xxx.jpg',          // 메인 카드 썸네일 = 첫 케이스 이미지와 동일 권장
  mode: 'preset',
  cases: [
    { id: 'case1', title: '케이스1 제목', img: 'styles/case1.jpg' },          // prompt 생략 → 부모 prompt 폴백
    { id: 'case2', title: '케이스2 제목', img: 'styles/case2.jpg',
      prompt: `...이 케이스 전용 프롬프트...` },
  ],
  prompt: `...기본 케이스용 폴백 프롬프트...` },
```

→ 상세 화면에 케이스 피커 버튼이 자동 노출, 선택한 케이스의 `prompt` (없으면 부모 `prompt`) 사용.

## 이미지 최적화 워크플로 (스타일 썸네일)

**카드 썸네일은 항상 최적화 후 커밋.** 원본(1–3MB) 그대로 두면 메인 로딩이 느려짐.

```bash
cd /Users/toolb/develop/tool/tbpic/styles

# 1) 원본 백업 (반드시)
mkdir -p original-backup && cp NEW.png original-backup/

# 2a) PNG → JPEG 변환 + 800px 리사이즈 (q=85) — 일러스트/사진 공통 권장
sips -s format jpeg -s formatOptions 85 --resampleWidth 800 NEW.png --out NEW.jpg && rm NEW.png

# 2b) JPEG 원본이면 리사이즈만 (q=82)
sips --resampleWidth 800 -s formatOptions 82 NEW.jpeg
```

- 목표: **150–250KB 수준**, 800px 너비
- `.png` → `.jpg` 변환 시 `index.html` 의 경로도 함께 치환 (Edit `replace_all: true`)
- 투명 배경이 꼭 필요한 경우에만 PNG 유지 (현재 스타일 썸네일에는 해당 없음)

## 프롬프트 구조 규칙

모든 스타일 변환(애니/피규어/지브리/흑백 등) 프롬프트는 **IDENTITY LOCK 블록으로 시작**.
"다른 사람이 나오는" 현상을 방지하기 위함이고, 스타일 변환 자체는 방해하지 않도록 "rendered in XX style"로 명시.

템플릿:

```
IDENTITY LOCK: The uploaded reference photo shows a SPECIFIC person. After {스타일} conversion, the result MUST be clearly recognizable as the SAME person — as if this exact individual was re-rendered in {스타일}, not a random {스타일} character.

Preserve these identity markers from the reference photo exactly, rendered in {스타일}:
- Eye shape, spacing, and angle
- Eyebrow shape and thickness
- Nose shape, bridge height, and tip
- Lip shape, thickness, and mouth width
- Face shape and jawline proportions
- Hair color, hairstyle, hair length, and parting direction
- Skin tone (adjusted to {스타일} palette but same base undertone)
- Any distinguishing features (moles, dimples, glasses)
- Original outfit and clothing style

Do not substitute with a generic {스타일} face. Do not change the person's ethnicity, age, or gender.

[POSITIVE]
{사용자가 준 positive 키워드 + "of the SAME person from reference" 한 줄 삽입}

[NEGATIVE]
{사용자가 준 negative 키워드 + generic {스타일} face, different person, different hairstyle, different hair color 추가}
```

- 사용자가 `[POSITIVE] / [NEGATIVE]` 블록만 준 경우에도 자동으로 앞에 IDENTITY LOCK 블록을 붙여준다.
- 사진 복원 같은 실물 유지 스타일(`restore`)에는 붙이지 않는다 — 해당 스타일은 이미 "keep original face" 명시되어 있고, IDENTITY LOCK을 중복으로 붙일 필요 없음.

## Gemini API 요청 규약 (`api/generate.js`)

**바꾸지 말 것:**

- 모델: `gemini-3.1-flash-image-preview` (Nano Banana 2, 이미지 생성)
- `parts` 순서: **`[inline_data, text]`** — 이미지를 먼저, 프롬프트를 나중에. 반대 순서면 레퍼런스 얼굴이 약하게 반영됨.
- `generationConfig.imageConfig.aspectRatio: '3:4'` — 출력 비율 고정. 입력 이미지 비율 무시하고 항상 세로 3:4.

**이미지 리사이즈 (클라이언트 업로드):**

- `resizeImageToDataUrl(file, maxSize=1536, quality=0.9)` — API 전송용. 너무 작게 줄이면(1024 미만) 얼굴 디테일 손실, 너무 크면(2048 초과) base64 팽창으로 전송 지연. **이 값 유지.**

## UI 레이아웃 규약

상세 화면(`.detail-body`)은 flex-column, `.upload-area`가 `flex: 1 1 auto; min-height: 240px`로 남는 수직 공간을 모두 차지. 케이스 피커와 액션 버튼이 먼저 자기 공간을 확보하고 나머지를 업로드 영역이 흡수 → 기기별로 균형 맞게 배치됨. `aspect-ratio` 고정은 커스텀 모드 외에는 쓰지 않음.

## 반복 요청 처리 규약

다음 패턴의 요청은 위 규약만 따라 **별도 확인 없이 바로 처리**한다:

1. **"카드(스타일) 하나 더 추가해줘"** — 이미지 경로 + 프롬프트를 주면:
   - 이미지를 위 "이미지 최적화 워크플로"로 처리 (백업 → 800px → JPEG)
   - `STYLES` 배열에 삽입 (사용자가 특정 위치 언급 없으면 비슷한 성격의 스타일 근처)
   - 프롬프트는 "프롬프트 구조 규칙" 템플릿 적용 (IDENTITY LOCK 자동 삽입)
2. **"X 스타일에 케이스 하나 더"** — 해당 스타일의 `cases` 배열에 삽입. 단일 스타일이었으면 먼저 cases 구조로 변환 후 기존 프롬프트를 첫 케이스 폴백으로 유지.
3. **"이미지 용량이 커서 느려"** — 해당 폴더 `ls -lh` 확인 → 큰 파일만 위 워크플로로 최적화 (원본 그대로 달라고 하지 않는 한).
4. **"다른 사람 나와 / 얼굴 바뀌어"** — 해당 스타일 프롬프트에 IDENTITY LOCK 블록 없으면 추가, 이미 있으면 더 강화 (구체 마커 나열).

확인 필수 케이스:
- 파일 삭제/기존 이미지 덮어쓰기 (원본이 `original-backup/`에 없는 경우)
- 프롬프트를 "처음부터 새로 써줘" 같은 대규모 재작성
- 배포(`vercel --prod` 등) — 사용자가 명시적으로 요청할 때만
