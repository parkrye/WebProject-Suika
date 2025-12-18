# Fireworks Festival

멀티플레이어 협동 폭죽 합치기 게임

## Game URL

**https://multi-suika-game.web.app**

---

## Player Guide

### How to Play

1. **방 만들기 / 참가하기**
   - 게임 접속 후 닉네임 입력
   - "Create Room"으로 새 방 생성 또는 "Join Room"으로 기존 방 참가
   - 방장이 "Start Game" 버튼을 누르면 게임 시작
   - 최대 10명까지 참가 가능

2. **게임 규칙**
   - 턴제로 진행되며, 자신의 턴에 폭죽을 떨어뜨립니다
   - 같은 크기의 폭죽 2개가 충돌하면 합쳐져서 더 큰 폭죽이 됩니다
   - 크기 1 → 2 → 3 → ... → 10 (최대)
   - 크기 10 폭죽 2개가 합쳐지면 폭죽이 터지며 사라집니다
   - 폭죽이 게임오버 라인 위에 2초 이상 머물면 게임 종료

3. **조작법**
   - `◀` / `▶` 버튼: 폭죽 좌우 이동
   - `DROP` 버튼: 폭죽 떨어뜨리기
   - 턴 시간(10초) 내에 드롭하지 않으면 자동 드롭

4. **점수 시스템**
   - 폭죽을 합칠 때마다 점수 획득 (큰 폭죽일수록 높은 점수)
   - **파티 점수**: 모든 플레이어 점수 합계
   - **인원 배율**: 인원이 많을수록 최종 점수 배율 증가 (최대 x2.0)
   - **최종 점수**: 파티 점수 × 인원 배율

### 인원 배율표

| 인원 | 배율 |
|------|------|
| 1명 | x1.00 |
| 2명 | x1.30 |
| 3명 | x1.48 |
| 4명 | x1.60 |
| 5명 | x1.70 |
| 6명 | x1.78 |
| 7명 | x1.85 |
| 8명 | x1.90 |
| 9명 | x1.95 |
| 10명 | x2.00 |

### Sound Settings

우측 상단 🔊 버튼을 클릭하여:
- BGM 볼륨 조절
- 효과음(SFX) 볼륨 조절
- 전체 음소거

설정은 자동으로 저장됩니다.

---

## Developer Guide

### Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Physics | Matter.js |
| Rendering | Canvas 2D API |
| Backend | Firebase Realtime Database |
| Build | Vite |
| Hosting | Firebase Hosting |

### Project Structure

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
│   ├── NetworkManager.ts   # Firebase 통신, 방 관리 (최대 10명)
│   ├── GameSync.ts         # 게임 상태 동기화
│   ├── firebase.ts         # Firebase 초기화
│   └── types.ts            # 네트워크 타입
├── ui/                 # UI 컴포넌트
│   ├── Lobby.ts            # 로비 화면
│   └── AudioControl.ts     # 음량 조절 UI
└── main.ts             # 진입점

public/
├── fireworks/          # 폭죽 이미지
│   └── firework_{1-10}.png
├── bgm/                # 배경음악
│   ├── main.mp3            # 게임 중 BGM
│   └── lobby.mp3           # 로비 BGM (선택)
└── sfx/                # 효과음
    ├── drop.mp3            # 폭죽 드롭
    ├── merge.mp3           # 폭죽 합성
    ├── gameover.mp3        # 게임 오버
    ├── turn_start.mp3      # 턴 시작 (선택)
    └── click.mp3           # UI 클릭 (선택)
```

### Getting Started

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 타입 체크
npx tsc --noEmit

# 빌드
npm run build

# Firebase 배포
firebase deploy
```

### Environment Variables

`.env` 파일에 Firebase 설정 추가:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Architecture

**Host-Client Model**
- 호스트: 물리 시뮬레이션 실행, 상태를 Firebase에 동기화
- 클라이언트: Firebase에서 상태를 받아 렌더링만 수행

**Event Flow**
```
Player Input → Host Physics → Firebase → All Clients Render
```

### Adding Assets

**Images (폭죽)**
- 경로: `public/fireworks/firework_{1-10}.png`
- 형식: PNG (투명 배경 권장)
- 크기: 정사각형, radius * 2 이상
- 이미지가 없으면 색상 원으로 fallback

**BGM**
- 경로: `public/bgm/main.mp3`
- 형식: MP3 또는 OGG
- 루프 가능하게 편집 권장

**SFX**
- 경로: `public/sfx/{drop|merge|gameover}.mp3`
- 형식: MP3 또는 WAV

### Audio System

```typescript
const audio = AudioManager.getInstance();
audio.playBGM('MAIN');        // BGM 재생
audio.stopBGM();              // BGM 정지
audio.playSFX('DROP');        // 효과음 재생
audio.setBGMVolume(0.5);      // 볼륨 0~1
audio.setSFXVolume(0.7);
audio.toggleMute();           // 음소거 토글
```

- 브라우저 Autoplay 정책 대응 (첫 클릭 후 재생)
- localStorage에 설정 자동 저장

### Score System

**인원 배율 공식**: `1 + ln(n) / ln(10)`
- 1명: x1.0, 10명: x2.0
- 증가폭이 점점 감소하는 로그 곡선

**게임 오버 연출 순서**:
1. 플레이어별 기여 점수 공개 (애니메이션)
2. 파티 점수 합산 (카운트업)
3. 인원 배율 표시
4. 최종 점수 공개 + Top 3 공로자

### Code Conventions

- 클래스: `PascalCase`
- 함수/변수: `camelCase`
- 상수: `UPPER_SNAKE_CASE`
- 타입: `any` 사용 금지, 명시적 타입 선언

### Key Files

| File | Description |
|------|-------------|
| `src/core/config.ts` | 게임 설정값 (폭죽 크기, 점수, 이미지 경로) |
| `src/core/AudioManager.ts` | 오디오 시스템 (BGM, SFX, 볼륨) |
| `src/game/MultiplayerGame.ts` | 메인 게임 로직, 점수 연출 |
| `src/game/Renderer.ts` | 렌더링 (이미지/색상 fallback) |
| `src/network/GameSync.ts` | 실시간 동기화 |
| `src/network/NetworkManager.ts` | 방 관리, Firebase 통신 |
| `src/ui/AudioControl.ts` | 음량 조절 UI |

---

## Documentation

- [개발 가이드](.claude/CLAUDE.md) - 코드 컨벤션, 아키텍처, 시스템 설명
- [게임 규칙](.claude/GAMERULE.md) - 상세 게임 규칙 및 점수 계산

---

## License

MIT
