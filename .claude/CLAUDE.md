# WebProject-Suika 개발 가이드

## 기술 스택

### Runtime
- TypeScript (필수)
- JavaScript (레거시 호환)

### Physics Engine
- Matter.js (현재 사용)

### Rendering
- Canvas 2D API (현재 사용)

### Networking
- Firebase Realtime Database
- Firebase Authentication (선택)
- Firebase Hosting

### Build System
- Vite (현재 사용)
- TypeScript Compiler

### Deployment
- Firebase Hosting

---

## 개발 원칙

### 1. SOLID 원칙 준수

#### S - Single Responsibility Principle (단일 책임 원칙)
- 각 클래스/모듈은 하나의 책임만 가져야 함
- 예: `NetworkManager`는 네트워크 통신만, `GameSync`는 게임 상태 동기화만

#### O - Open/Closed Principle (개방-폐쇄 원칙)
- 확장에는 열려있고, 수정에는 닫혀있어야 함
- 새로운 기능 추가 시 기존 코드 수정 최소화

#### L - Liskov Substitution Principle (리스코프 치환 원칙)
- 하위 타입은 상위 타입을 대체할 수 있어야 함

#### I - Interface Segregation Principle (인터페이스 분리 원칙)
- 클라이언트가 사용하지 않는 인터페이스에 의존하지 않도록 분리

#### D - Dependency Inversion Principle (의존성 역전 원칙)
- 고수준 모듈이 저수준 모듈에 의존하지 않고, 추상화에 의존

### 2. 하드코딩 금지

#### 설정값은 상수로 분리
```typescript
// BAD
const fruit = Matter.Bodies.circle(x, y, 15, {...});

// GOOD
const FRUIT_SIZES = [
  { size: 1, radius: 15, color: '#FF6B6B' },
  ...
];
const fruit = Matter.Bodies.circle(x, y, FRUIT_SIZES[size - 1].radius, {...});
```

#### 매직 넘버 사용 금지
```typescript
// BAD
if (this.settleCheckTimer > 180) { ... }

// GOOD
const SETTLE_FRAMES = 180; // 3초 (60fps * 3)
if (this.settleCheckTimer > SETTLE_FRAMES) { ... }
```

#### 설정 파일 활용
- `src/core/config.ts`에 게임 설정값 집중
- 환경별 설정은 `.env` 파일 사용

### 3. 코드 품질

#### 타입 안전성
- `any` 타입 사용 금지
- 명시적 타입 선언 권장
- `strict` 모드 사용

#### 에러 처리
- try-catch로 에러 핸들링
- 사용자에게 의미있는 에러 메시지 제공
- 콘솔 로그는 개발 중에만 사용

#### 네이밍 컨벤션
- 클래스: PascalCase (`MultiplayerGame`)
- 함수/변수: camelCase (`handleTurnStart`)
- 상수: UPPER_SNAKE_CASE (`TURN_TIME`)
- private 멤버: 접두사 없음, `private` 키워드 사용

### 4. 아키텍처 패턴

#### 호스트-클라이언트 모델 (멀티플레이어)
- 호스트: 물리 시뮬레이션 실행, 상태 동기화
- 클라이언트: 렌더링만, Firebase 상태 반영

#### 이벤트 기반 통신
- `GameSync`를 통한 이벤트 발행/구독
- 중복 이벤트 방지 로직 필수

#### 상태 관리
- 단방향 데이터 흐름
- Firebase → GameSync → MultiplayerGame

### 5. 성능 최적화

#### 렌더링
- `requestAnimationFrame` 사용
- 불필요한 리렌더링 방지

#### 네트워크
- Firebase 동기화 주기 조절 (매 프레임 X)
- 배치 업데이트 활용

#### 메모리
- 이벤트 리스너 정리 (`off`, `removeEventListener`)
- 사용하지 않는 객체 참조 해제

---

## 프로젝트 구조

```
src/
├── core/           # 핵심 설정, 타입, 물리엔진 래퍼
│   ├── config.ts
│   ├── types.ts
│   └── Physics.ts
├── game/           # 게임 로직
│   ├── MultiplayerGame.ts
│   ├── Fruit.ts
│   └── Renderer.ts
├── network/        # 네트워크 통신
│   ├── NetworkManager.ts
│   ├── GameSync.ts
│   ├── firebase.ts
│   └── types.ts
├── ui/             # UI 컴포넌트
│   └── Lobby.ts
└── main.ts         # 진입점
```

---

## Git 컨벤션

### 커밋 메시지
```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

#### Type
- `feat`: 새로운 기능
- `fix`: 버그 수정
- `refactor`: 리팩토링
- `docs`: 문서 수정
- `style`: 코드 스타일 변경
- `test`: 테스트 추가/수정
- `chore`: 빌드, 설정 변경

### 브랜치 전략
- `master`: 배포 가능한 상태
- `feature/*`: 기능 개발
- `fix/*`: 버그 수정

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
