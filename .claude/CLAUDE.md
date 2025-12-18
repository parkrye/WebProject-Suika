# Fireworks Festival 개발 가이드

## 기술 스택

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Physics | Matter.js |
| Rendering | Canvas 2D API |
| Backend | Firebase Realtime Database |
| Build | Vite |
| Hosting | Firebase Hosting |

---

## 프로젝트 구조

```
src/
├── core/               # 핵심 설정, 타입
│   ├── config.ts           # 게임 설정값 (폭죽 크기, 점수, 이미지 경로)
│   ├── types.ts            # 타입 정의
│   ├── Physics.ts          # 물리엔진 래퍼
│   └── AudioManager.ts     # 오디오 관리 (BGM, SFX)
├── game/               # 게임 로직
│   ├── MultiplayerGame.ts  # 메인 게임 클래스
│   ├── Fruit.ts            # 폭죽 클래스
│   ├── Game.ts             # 싱글플레이어 (레거시)
│   └── Renderer.ts         # 렌더링 (이미지/색상 fallback)
├── network/            # 네트워크 통신
│   ├── NetworkManager.ts   # Firebase 통신, 방 관리
│   ├── GameSync.ts         # 게임 상태 동기화
│   ├── firebase.ts         # Firebase 초기화
│   ├── index.ts            # 모듈 export
│   └── types.ts            # 네트워크 타입
├── ui/                 # UI 컴포넌트
│   ├── Lobby.ts            # 로비 화면
│   └── AudioControl.ts     # 음량 조절 UI
└── main.ts             # 진입점

public/
├── fireworks/          # 폭죽 이미지
│   └── firework_{1-10}.png
├── bgm/                # 배경음악
│   ├── main.mp3
│   └── lobby.mp3
└── sfx/                # 효과음
    ├── drop.mp3
    ├── merge.mp3
    ├── gameover.mp3
    ├── turn_start.mp3
    └── click.mp3
```

---

## 개발 원칙

### 1. SOLID 원칙 준수

| 원칙 | 설명 | 예시 |
|------|------|------|
| S - 단일 책임 | 각 클래스는 하나의 책임만 | `NetworkManager`는 통신만, `GameSync`는 동기화만 |
| O - 개방/폐쇄 | 확장에 열려있고, 수정에 닫혀있음 | 새 기능 추가 시 기존 코드 수정 최소화 |
| L - 리스코프 치환 | 하위 타입은 상위 타입 대체 가능 | - |
| I - 인터페이스 분리 | 불필요한 의존성 제거 | - |
| D - 의존성 역전 | 추상화에 의존 | - |

### 2. 하드코딩 금지

```typescript
// BAD
const firework = Matter.Bodies.circle(x, y, 15, {...});

// GOOD
const FRUIT_DATA = [
  { size: 1, radius: 15, color: '#FF6B9D', score: 0, image: '/fireworks/firework_1.png' },
  ...
];
const firework = Matter.Bodies.circle(x, y, FRUIT_DATA[size - 1].radius, {...});
```

설정값은 `src/core/config.ts`에 집중 관리

### 3. 코드 품질

- `any` 타입 사용 금지
- 명시적 타입 선언
- `strict` 모드 사용
- try-catch로 에러 핸들링

### 4. 네이밍 컨벤션

| 종류 | 규칙 | 예시 |
|------|------|------|
| 클래스 | PascalCase | `MultiplayerGame` |
| 함수/변수 | camelCase | `handleTurnStart` |
| 상수 | UPPER_SNAKE_CASE | `TURN_TIME` |
| private | `private` 키워드 사용 | `private score` |

---

## 아키텍처

### Host-Client 모델

```
Player Input → Host Physics → Firebase → All Clients Render
```

- **호스트**: 물리 시뮬레이션 실행, 상태를 Firebase에 동기화
- **클라이언트**: Firebase에서 상태를 받아 렌더링만 수행

### 이벤트 기반 통신

- `GameSync`를 통한 이벤트 발행/구독
- 중복 이벤트 방지 로직 필수

### 상태 관리

- 단방향 데이터 흐름: Firebase → GameSync → MultiplayerGame

---

## 주요 시스템

### 오디오 시스템 (AudioManager)

```typescript
const audio = AudioManager.getInstance();
audio.playBGM('MAIN');        // BGM 재생
audio.stopBGM();              // BGM 정지
audio.playSFX('DROP');        // 효과음 재생
audio.setBGMVolume(0.5);      // 볼륨 설정 (0~1)
audio.setSFXVolume(0.7);
audio.toggleMute();           // 음소거 토글
```

- 브라우저 Autoplay 정책 대응 (사용자 상호작용 후 재생)
- localStorage에 설정 자동 저장

### 렌더링 시스템 (Renderer)

- 이미지가 있으면 이미지 렌더링
- 이미지 없으면 색상 원으로 fallback
- `config.ts`의 `FRUIT_DATA`에서 이미지 경로 관리

### 점수 시스템

- 인원 배율: `1 + ln(n) / ln(10)` (1명 x1.0, 10명 x2.0)
- 게임 오버 시 단계별 연출 (기여 점수 → 합산 → 배율 → 최종 점수)

---

## 게임 설정값 (config.ts)

| 상수 | 값 | 설명 |
|------|---|------|
| `TURN_TIME` | 10 | 턴 제한 시간 (초) |
| `GAME_OVER_LINE_Y` | 100 | 게임오버 라인 Y좌표 |
| `MAX_FRUIT_SIZE` | 10 | 최대 폭죽 크기 |
| `SETTLE_FRAMES` | 15 | 안정화 대기 프레임 |

---

## 명령어

```bash
# 개발 서버
npm run dev

# 타입 체크
npx tsc --noEmit

# 빌드
npm run build

# Firebase 배포
firebase deploy
```

---

## 체크리스트

### 코드 작성 전
- [ ] 기존 코드 구조 파악
- [ ] 영향 범위 확인
- [ ] 설정값 하드코딩 여부 확인

### 코드 작성 후
- [ ] TypeScript 타입 체크 통과 (`npx tsc --noEmit`)
- [ ] 콘솔 에러 없음
- [ ] 불필요한 console.log 제거
- [ ] 중복 코드 제거

---

## Git 컨벤션

### 커밋 메시지

```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Type

| Type | 설명 |
|------|------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 |
| `docs` | 문서 수정 |
| `style` | 코드 스타일 변경 |
| `chore` | 빌드, 설정 변경 |

### 브랜치 전략

- `master`: 배포 가능한 상태
- `feature/*`: 기능 개발
- `fix/*`: 버그 수정
