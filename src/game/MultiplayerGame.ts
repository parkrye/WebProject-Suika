import Matter from 'matter-js';
import { GameSync, type GameSyncEvent } from '../network/GameSync';
import type { RoomPlayer, FruitState, RoomState } from '../network/types';
import { FRUIT_DATA, MAX_FRUIT_SIZE, SETTLE_FRAMES } from '../core/config';
import { AudioManager } from '../core/AudioManager';

const WIDTH = 400;
const HEIGHT = 600;
const UI_AREA_HEIGHT = 70;    // 상단 UI 영역 높이
const CEILING_Y = UI_AREA_HEIGHT; // 천장 Y좌표 (오브젝트가 여기에 쌓임)
const LAUNCH_Y = 540;         // 발사 위치 (하단)
const GAME_OVER_Y = 500;      // 게임오버 라인 (하단, 오브젝트가 여기까지 내려오면 위험)
const TURN_TIME = 10;
const SYNC_INTERVAL = 5; // 호스트가 몇 프레임마다 동기화할지
const GAME_OVER_CHECK_FRAMES = 120; // 게임오버 판정까지 2초 (60fps * 2)
const DROP_GRACE_FRAMES = 180; // 드롭 후 3초 동안은 게임오버 체크 안함
const DROP_DELAY_MS = 1000; // 턴 시작 후 발사 활성화까지 1초

// 슬링샷 관련 상수 (모바일 최적화)
const SLINGSHOT_ZONE_TOP = 350;    // 터치 영역 시작 Y좌표 (넓은 터치 영역)
const PULL_START_THRESHOLD = 30;   // 당기기 시작 임계값 (LAUNCH_Y 기준 아래로 이 거리)
const MIN_PULL_DISTANCE = 40;      // 최소 당김 거리 (모바일에서 실수 방지)
const MAX_PULL_DISTANCE = 120;     // 최대 당김 거리 (손가락 이동 범위 고려)
const MIN_LAUNCH_SPEED = 5;        // 최소 발사 속도
const MAX_LAUNCH_SPEED = 15;       // 최대 발사 속도

// 합성 시 튕김 계수 (속도 벡터 크기에 비례)
const MERGE_BOUNCE_MULTIPLIER = 1.2; // 합성 전 속도의 120%로 튕김

// 크기 10 폭발 충격파
const EXPLOSION_RADIUS = 200;      // 충격파 영향 범위 (px)
const EXPLOSION_FORCE = 0.05;      // 충격파 힘

type TurnPhase = 'waiting' | 'ready' | 'dropping' | 'settling';
type SlingshotPhase = 'idle' | 'positioning' | 'pulling';

// 폭죽 파티클 인터페이스
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export class MultiplayerGame {
  private ctx: CanvasRenderingContext2D;
  private sync: GameSync;

  // Matter.js (호스트만 실제로 사용)
  private engine: Matter.Engine;
  private fruits = new Map<string, Matter.Body>();

  // 게임 상태
  private maxFruitSize = 1;
  private isRunning = false;

  // 턴 상태
  private turnPhase: TurnPhase = 'waiting';
  private dropX = WIDTH / 2;
  private currentFruitSize = 1;
  private droppedFruitId: string | null = null;
  private lastDropPlayerId: string | null = null; // 마지막 드롭한 플레이어 (합성 점수용)

  // 비호스트용: 드롭 요청 후 로컬 예측 렌더링용 임시 과일
  private pendingDropFruitId: string | null = null;
  private pendingDropSynced = false; // Firebase에서 첫 동기화 완료 여부

  // 타이머
  private timeRemaining = TURN_TIME;
  private timerInterval: number | null = null;

  // 드롭 활성화 (턴 시작 1초 후)
  private dropEnabled = false;
  private dropDelayTimer: number | null = null;

  // 슬링샷 상태
  private slingshotPhase: SlingshotPhase = 'idle';
  private slingshotStartX = 0;
  private slingshotStartY = 0;
  private slingshotCurrentX = 0;
  private slingshotCurrentY = 0;
  private launchVelocity: { x: number; y: number } = { x: 0, y: 0 };

  // 비행 중인 과일 (중력 무시, 충돌 시 해제) - 발사 속도 저장
  private inFlightFruits = new Map<string, { vx: number; vy: number }>();

  // 충돌 처리
  private mergedPairs = new Set<string>();
  private settleCheckTimer = 0;
  private frameCount = 0;

  // Firebase에서 받은 과일 상태 (비호스트용)
  private remoteFruits: Record<string, FruitState> = {};

  // 호스트가 삭제한 과일 ID (Firebase 동기화 지연으로 인한 재생성 방지)
  private deletedFruitIds = new Set<string>();

  // 폭죽 파티클 시스템
  private particles: Particle[] = [];

  // 게임오버 판정 타이머
  private gameOverTimer = 0;
  private isOverLine = false;
  private lastDropFrame = 0; // 마지막 드롭 프레임 (3초 후부터 게임오버 체크)

  // 도시 창문 패턴 (고정)
  private windowPattern: boolean[][] = [];

  // 오디오 매니저
  private audio: AudioManager;

  constructor(canvas: HTMLCanvasElement, sync: GameSync) {
    this.audio = AudioManager.getInstance();
    this.ctx = canvas.getContext('2d')!;
    this.sync = sync;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    // Matter.js 엔진 생성 (호스트만 실제로 물리 계산)
    this.engine = Matter.Engine.create();
    this.engine.world.gravity.y = -1; // 중력이 위쪽으로 (오브젝트가 천장에 쌓임)

    // 벽 생성 (바닥, 좌우 벽, 천장)
    const walls = [
      Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + 10, WIDTH + 40, 20, { isStatic: true, label: 'floor' }),
      Matter.Bodies.rectangle(-10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(WIDTH + 10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
      // 천장 (UI 영역 아래, 폭죽이 여기에 쌓임)
      Matter.Bodies.rectangle(WIDTH / 2, CEILING_Y - 10, WIDTH + 40, 20, { isStatic: true, label: 'ceiling' }),
    ];
    Matter.Composite.add(this.engine.world, walls);

    // 충돌 이벤트 (호스트만)
    Matter.Events.on(this.engine, 'collisionStart', (event) => this.handleCollision(event));

    // 입력 설정
    this.setupInput();

    // 네트워크 이벤트
    this.setupSyncEvents();

    // 도시 창문 패턴 생성 (고정)
    this.generateWindowPattern();
  }

  private generateWindowPattern(): void {
    const frontBuildings = [
      { w: 35, h: 50 }, { w: 25, h: 65 }, { w: 40, h: 45 }, { w: 30, h: 60 },
      { w: 45, h: 40 }, { w: 35, h: 70 }, { w: 40, h: 55 }, { w: 30, h: 75 },
      { w: 45, h: 45 }, { w: 35, h: 60 },
    ];

    for (const b of frontBuildings) {
      const windowRows = Math.floor(b.h / 12);
      const windowCols = Math.floor(b.w / 10);
      const buildingWindows: boolean[] = [];
      for (let i = 0; i < windowRows * windowCols; i++) {
        buildingWindows.push(Math.random() > 0.4);
      }
      this.windowPattern.push(buildingWindows);
    }
  }

  private setupInput(): void {
    const canvas = this.ctx.canvas;

    // 캔버스에 포인터 이벤트 바인딩
    canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    canvas.addEventListener('pointerleave', this.handlePointerUp.bind(this));
    canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));

    // 컨텍스트 메뉴 방지
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 터치 디바이스에서 스크롤 방지
    canvas.style.touchAction = 'none';
  }

  private getCanvasPosition(e: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (WIDTH / rect.width),
      y: (e.clientY - rect.top) * (HEIGHT / rect.height),
    };
  }

  private handlePointerDown(e: PointerEvent): void {
    // 내 턴이 아니거나 ready 상태가 아니거나 발사 비활성화면 무시
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready' || !this.dropEnabled) return;

    const { x, y } = this.getCanvasPosition(e);

    // 터치 영역(하단) 체크
    if (y >= SLINGSHOT_ZONE_TOP && y <= HEIGHT) {
      this.slingshotPhase = 'positioning';
      this.slingshotCurrentX = x;
      this.slingshotCurrentY = y;

      // 폭죽을 터치 X 위치로 이동
      const radius = FRUIT_DATA[this.currentFruitSize - 1].radius;
      this.dropX = Math.max(radius + 4, Math.min(WIDTH - radius - 4, x));

      // 당김 시작 위치는 현재 dropX 위치 (X 이동 후 당기기 시작점)
      this.slingshotStartX = this.dropX;
      this.slingshotStartY = LAUNCH_Y;

      // 포인터 캡처
      this.ctx.canvas.setPointerCapture(e.pointerId);
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.slingshotPhase === 'idle') return;

    const { x, y } = this.getCanvasPosition(e);
    this.slingshotCurrentX = x;
    this.slingshotCurrentY = y;

    if (this.slingshotPhase === 'positioning') {
      // 발사 위치 기준으로 아래로 일정 거리 드래그하면 당기기 시작
      const pullThreshold = LAUNCH_Y + PULL_START_THRESHOLD;

      if (y <= pullThreshold) {
        // 아직 당기기 전 - 수평 이동 가능
        const radius = FRUIT_DATA[this.currentFruitSize - 1].radius;
        this.dropX = Math.max(radius + 4, Math.min(WIDTH - radius - 4, x));
        // 당김 시작 위치도 현재 dropX로 업데이트
        this.slingshotStartX = this.dropX;
        this.slingshotStartY = LAUNCH_Y;
      } else {
        // 아래로 당김 시작 (X는 현재 위치 고정)
        this.slingshotPhase = 'pulling';
        this.slingshotStartX = this.dropX;
        this.slingshotStartY = LAUNCH_Y;
        this.calculateLaunchVelocity();
      }
    } else if (this.slingshotPhase === 'pulling') {
      // 당기는 중 - 속도 계산
      this.calculateLaunchVelocity();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.slingshotPhase === 'idle') return;

    if (this.slingshotPhase === 'pulling') {
      // 발사 속도 계산
      this.calculateLaunchVelocity();
      const pullDistance = Math.sqrt(
        Math.pow(this.slingshotCurrentX - this.slingshotStartX, 2) +
        Math.pow(this.slingshotCurrentY - this.slingshotStartY, 2)
      );

      // 최소 당김 거리 이상이면 발사
      if (pullDistance >= MIN_PULL_DISTANCE) {
        this.launchFruit();
      }
      // 당김이 부족하면 발사 안함, X 위치는 유지
    }
    // positioning 상태에서 터치를 떼면 X 위치 유지 (발사 안함)

    // 상태 초기화
    this.slingshotPhase = 'idle';
    this.launchVelocity = { x: 0, y: 0 };

    try {
      this.ctx.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // 이미 릴리즈됨
    }
  }

  private calculateLaunchVelocity(): void {
    // 당긴 벡터: 현재 → 시작 (당긴 반대 방향으로 발사)
    const dx = this.slingshotStartX - this.slingshotCurrentX;
    const dy = this.slingshotStartY - this.slingshotCurrentY;

    const pullDistance = Math.sqrt(dx * dx + dy * dy);

    if (pullDistance < MIN_PULL_DISTANCE) {
      this.launchVelocity = { x: 0, y: 0 };
      return;
    }

    // 당김 거리 클램프
    const clampedPull = Math.min(pullDistance, MAX_PULL_DISTANCE);

    // 속도 선형 보간
    const t = (clampedPull - MIN_PULL_DISTANCE) / (MAX_PULL_DISTANCE - MIN_PULL_DISTANCE);
    const speed = MIN_LAUNCH_SPEED + t * (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED);

    // 방향 정규화 및 속도 적용
    const nx = dx / pullDistance;
    const ny = dy / pullDistance;

    this.launchVelocity = {
      x: nx * speed,
      y: ny * speed,
    };
  }

  private renderSlingshotUI(ctx: CanvasRenderingContext2D): void {
    const data = FRUIT_DATA[this.currentFruitSize - 1];

    // 터치 영역 힌트 (하단 영역) - idle 상태에서만
    if (this.slingshotPhase === 'idle' && this.dropEnabled) {
      // 터치 힌트 영역
      const gradient = ctx.createLinearGradient(0, SLINGSHOT_ZONE_TOP, 0, HEIGHT);
      gradient.addColorStop(0, 'rgba(255, 107, 157, 0)');
      gradient.addColorStop(0.5, 'rgba(255, 107, 157, 0.08)');
      gradient.addColorStop(1, 'rgba(255, 107, 157, 0.15)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, SLINGSHOT_ZONE_TOP, WIDTH, HEIGHT - SLINGSHOT_ZONE_TOP);

      // 아래 화살표 아이콘
      const arrowY = LAUNCH_Y + 35;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(WIDTH / 2, arrowY + 15);
      ctx.lineTo(WIDTH / 2 - 12, arrowY);
      ctx.lineTo(WIDTH / 2 + 12, arrowY);
      ctx.closePath();
      ctx.fill();

      // 터치 힌트 텍스트
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Pull Down', WIDTH / 2, arrowY + 35);
    }

    if (this.slingshotPhase === 'pulling') {
      // 당기는 중 - 고무줄 효과와 궤적 표시
      const pullDx = this.slingshotCurrentX - this.slingshotStartX;
      const pullDy = this.slingshotCurrentY - this.slingshotStartY;
      const pullDistance = Math.sqrt(pullDx * pullDx + pullDy * pullDy);
      const clampedPull = Math.min(pullDistance, MAX_PULL_DISTANCE);
      const stretchFactor = pullDistance > 0 ? clampedPull / pullDistance : 0;
      const powerRatio = clampedPull / MAX_PULL_DISTANCE; // 0~1 당김 강도

      // 발사 가능 여부
      const canLaunch = pullDistance >= MIN_PULL_DISTANCE;

      // 당겨진 폭죽 위치
      const fruitX = this.dropX + pullDx * stretchFactor * 0.5;
      const fruitY = LAUNCH_Y + pullDy * stretchFactor * 0.5;

      // 고무줄 색상 (당김 강도에 따라 변화)
      const rubberColor = canLaunch
        ? `rgb(${255}, ${Math.floor(107 - powerRatio * 50)}, ${Math.floor(157 - powerRatio * 100)})`
        : 'rgba(255, 107, 157, 0.5)';

      // 고무줄 (앵커에서 폭죽으로)
      const anchorLeft = this.dropX - 25;
      const anchorRight = this.dropX + 25;

      ctx.strokeStyle = rubberColor;
      ctx.lineWidth = 3 + powerRatio * 2;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(anchorLeft, LAUNCH_Y);
      ctx.lineTo(fruitX, fruitY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(anchorRight, LAUNCH_Y);
      ctx.lineTo(fruitX, fruitY);
      ctx.stroke();

      // 앵커 포인트
      ctx.fillStyle = rubberColor;
      ctx.beginPath();
      ctx.arc(anchorLeft, LAUNCH_Y, 6, 0, Math.PI * 2);
      ctx.arc(anchorRight, LAUNCH_Y, 6, 0, Math.PI * 2);
      ctx.fill();

      // 파워 게이지 (좌측)
      const gaugeX = 15;
      const gaugeY = LAUNCH_Y - 60;
      const gaugeHeight = 50;
      const gaugeWidth = 8;

      // 게이지 배경
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 4);
      ctx.fill();

      // 게이지 채움
      const fillHeight = gaugeHeight * powerRatio;
      const gaugeColor = canLaunch
        ? `rgb(${Math.floor(100 + powerRatio * 155)}, ${Math.floor(200 - powerRatio * 100)}, 100)`
        : 'rgba(150, 150, 150, 0.5)';
      ctx.fillStyle = gaugeColor;
      ctx.beginPath();
      ctx.roundRect(gaugeX, gaugeY + gaugeHeight - fillHeight, gaugeWidth, fillHeight, 4);
      ctx.fill();

      // 당겨진 폭죽
      ctx.beginPath();
      ctx.arc(fruitX, fruitY, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = canLaunch ? '#ffffff' : '#ffffff44';
      ctx.lineWidth = canLaunch ? 3 : 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.currentFruitSize.toString(), fruitX, fruitY);

      // 발사 불가 표시 (당김 부족)
      if (!canLaunch) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Pull more', WIDTH / 2, HEIGHT - 20);
      }

      // 궤적 예측선 (발사 가능할 때만)
      if (canLaunch && (this.launchVelocity.x !== 0 || this.launchVelocity.y !== 0)) {
        this.renderTrajectory(ctx);
      }
    } else {
      // 대기 중 또는 위치 조정 중 - 폭죽 프리뷰
      ctx.beginPath();
      ctx.arc(this.dropX, LAUNCH_Y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.currentFruitSize.toString(), this.dropX, LAUNCH_Y);

      // 위치 조정 중이면 가이드라인 + 힌트
      if (this.slingshotPhase === 'positioning') {
        // 수직 가이드라인
        ctx.strokeStyle = '#ffffff55';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(this.dropX, LAUNCH_Y - data.radius - 10);
        ctx.lineTo(this.dropX, CEILING_Y);
        ctx.stroke();
        ctx.setLineDash([]);

        // 좌우 이동 힌트 화살표
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        // 왼쪽 화살표
        ctx.beginPath();
        ctx.moveTo(this.dropX - data.radius - 20, LAUNCH_Y);
        ctx.lineTo(this.dropX - data.radius - 10, LAUNCH_Y - 8);
        ctx.lineTo(this.dropX - data.radius - 10, LAUNCH_Y + 8);
        ctx.closePath();
        ctx.fill();
        // 오른쪽 화살표
        ctx.beginPath();
        ctx.moveTo(this.dropX + data.radius + 20, LAUNCH_Y);
        ctx.lineTo(this.dropX + data.radius + 10, LAUNCH_Y - 8);
        ctx.lineTo(this.dropX + data.radius + 10, LAUNCH_Y + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private renderTrajectory(ctx: CanvasRenderingContext2D): void {
    // 직선 궤적 (중력 무시)
    const vx = this.launchVelocity.x;
    const vy = this.launchVelocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    if (speed < 0.1) return;

    // 방향 정규화
    const nx = vx / speed;
    const ny = vy / speed;

    // 직선 궤적 길이 (화면 경계까지)
    const maxLength = Math.max(WIDTH, HEIGHT);
    let endX = this.dropX + nx * maxLength;
    let endY = LAUNCH_Y + ny * maxLength;

    // 화면 경계에서 클리핑
    if (endX < 0) {
      const t = -this.dropX / nx;
      endX = 0;
      endY = LAUNCH_Y + ny * t;
    } else if (endX > WIDTH) {
      const t = (WIDTH - this.dropX) / nx;
      endX = WIDTH;
      endY = LAUNCH_Y + ny * t;
    }
    if (endY < 0) {
      const t = -LAUNCH_Y / ny;
      endX = this.dropX + nx * t;
      endY = 0;
    } else if (endY > HEIGHT) {
      const t = (HEIGHT - LAUNCH_Y) / ny;
      endX = this.dropX + nx * t;
      endY = HEIGHT;
    }

    // 점선 직선 그리기
    ctx.strokeStyle = '#ffffff88';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.dropX, LAUNCH_Y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 화살표 끝
    const angle = Math.atan2(ny, nx);
    const arrowSize = 8;

    ctx.fillStyle = '#ffffff88';
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowSize * Math.cos(angle - Math.PI / 6),
      endY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      endX - arrowSize * Math.cos(angle + Math.PI / 6),
      endY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  private setupSyncEvents(): void {
    this.sync.on((event: GameSyncEvent) => {
      switch (event.type) {
        case 'game_start':
          this.handleGameStart();
          break;
        case 'room_update':
          this.handleRoomUpdate();
          break;
        case 'turn_start':
          this.handleTurnStart(event.playerId, event.fruitSize, event.fruitX);
          break;
        case 'game_over':
          this.handleGameOver(event.partyScore);
          break;
        case 'drop_request':
          this.handleDropRequest(event.playerId, event.x, event.size, event.velocityX, event.velocityY);
          break;
      }
    });
  }

  private handleGameStart(): void {
    const room = this.sync.room;
    if (!room) return;

    const currentPlayerId = room.playerOrder[room.currentPlayerIndex];
    const fruitSize = room.currentFruit?.size || 1;
    const fruitX = room.currentFruit?.x || WIDTH / 2;

    this.handleTurnStart(currentPlayerId, fruitSize, fruitX);
  }

  private handleRoomUpdate(): void {
    const room = this.sync.room;
    if (!room) return;

    // Firebase에서 과일 상태 업데이트
    this.remoteFruits = room.fruits || {};

    // 서버의 maxFruitSize 동기화 (모든 플레이어)
    if (room.maxFruitSize > this.maxFruitSize) {
      this.maxFruitSize = room.maxFruitSize;
    }

    // 호스트 부재 감지 및 승격 처리
    if (this.sync.shouldBecomeHost) {
      console.log('[Game] 호스트 부재 감지, 새 호스트로 승격 시도');
      this.sync.promoteToHost();
      return; // 승격 후 다음 room_update에서 처리
    }

    if (this.sync.isHost) {
      // 호스트: Firebase에 새로 추가된 과일만 물리 엔진에 추가 (비호스트가 드롭한 과일)
      this.addNewFruitsFromRemote();

      // 호스트: 연결 해제된 플레이어 감지 및 정리
      this.checkAndCleanupDisconnectedPlayers(room);
    } else {
      // 비호스트: Firebase 상태를 로컬에 반영
      this.syncFruitsFromRemote();
    }
  }

  // 호스트 전용: players와 playerOrder 불일치 감지 및 정리
  private checkAndCleanupDisconnectedPlayers(room: RoomState): void {
    const activePlayers = Object.keys(room.players);
    const hasDisconnected = room.playerOrder.some(
      (id: string) => !activePlayers.includes(id)
    );

    if (hasDisconnected) {
      console.log('[Host] 연결 해제된 플레이어 감지, 정리 중...');
      this.sync.cleanupDisconnectedPlayers();
    }
  }

  // 호스트 전용: 비호스트가 드롭한 새 과일만 물리 엔진에 추가
  private addNewFruitsFromRemote(): void {
    const remoteCount = Object.keys(this.remoteFruits).length;
    const localCount = this.fruits.size;
    if (this.frameCount % 60 === 0 && remoteCount > 0) {
      console.log('[Host] addNewFruitsFromRemote - remote:', remoteCount, 'local:', localCount);
    }

    for (const [id, fruitState] of Object.entries(this.remoteFruits)) {
      // 최근 삭제된 과일은 무시 (Firebase 동기화 지연으로 인한 재생성 방지)
      if (this.deletedFruitIds.has(id)) {
        continue;
      }
      if (!this.fruits.has(id)) {
        // 새 과일 생성 (비호스트가 드롭한 것)
        console.log('[Host] 비호스트 과일 추가:', id, 'x:', fruitState.x, 'y:', fruitState.y, 'size:', fruitState.size);
        this.createFruitWithId(id, fruitState.x, fruitState.y, fruitState.size);
      }
      // 기존 과일 위치는 업데이트하지 않음 (호스트가 물리 시뮬레이션 권위자)
    }

    // Firebase에서 삭제된 과일은 deletedFruitIds에서도 제거 (메모리 정리)
    for (const id of this.deletedFruitIds) {
      if (!this.remoteFruits[id]) {
        this.deletedFruitIds.delete(id);
      }
    }
  }

  private syncFruitsFromRemote(): void {
    // 비호스트: Firebase 상태를 그대로 반영
    const remoteIds = new Set(Object.keys(this.remoteFruits));
    const remoteCount = remoteIds.size;

    // 임시 과일이 있고 아직 동기화되지 않았는데, Firebase에서 새 과일이 왔으면 동기화 완료
    if (this.pendingDropFruitId && !this.pendingDropSynced && remoteCount > 0) {
      // Firebase에서 첫 번째 과일 업데이트가 왔으면 임시 과일 제거
      this.pendingDropSynced = true;
      console.log('[Sync] Firebase 동기화 완료, 임시 과일 제거 예정:', this.pendingDropFruitId);
    }

    // 원격에 없는 로컬 과일 제거
    for (const [id, body] of this.fruits) {
      if (!remoteIds.has(id)) {
        // 임시 과일은 동기화 완료 후에만 제거
        if (id === this.pendingDropFruitId) {
          if (this.pendingDropSynced) {
            console.log('[Sync] 임시 과일 제거:', id);
            Matter.Composite.remove(this.engine.world, body);
            this.fruits.delete(id);
            this.pendingDropFruitId = null;
          }
          // 아직 동기화 안됐으면 임시 과일 유지
          continue;
        }
        Matter.Composite.remove(this.engine.world, body);
        this.fruits.delete(id);
      }
    }

    // 원격 과일 생성 또는 위치 업데이트
    for (const [id, fruitState] of Object.entries(this.remoteFruits)) {
      const existingBody = this.fruits.get(id);
      if (existingBody) {
        // 위치 업데이트
        Matter.Body.setPosition(existingBody, { x: fruitState.x, y: fruitState.y });
        Matter.Body.setVelocity(existingBody, { x: 0, y: 0 });
      } else {
        // 새 과일 생성
        this.createFruitWithId(id, fruitState.x, fruitState.y, fruitState.size);
      }
    }
  }

  // 마지막으로 처리한 턴 시작 시간 (중복 방지)
  private lastTurnStartTime = 0;

  private handleTurnStart(_playerId: string, fruitSize: number, fruitX: number): void {
    const room = this.sync.room;
    if (!room) return;

    // 이미 처리한 턴이면 무시 (중복 방지)
    if (room.turnStartTime === this.lastTurnStartTime) {
      console.log('[TurnStart] 중복 이벤트 무시');
      return;
    }

    // settling 중이면 턴 시작 무시
    if (this.turnPhase === 'settling') {
      console.log('[TurnStart] settling 중이므로 무시');
      return;
    }

    this.lastTurnStartTime = room.turnStartTime;
    console.log('[TurnStart] playerId:', _playerId, 'isMyTurn:', this.sync.isMyTurn, 'turnStartTime:', room.turnStartTime);

    this.stopTimer();
    this.clearDropDelay();
    this.turnPhase = 'ready';
    this.currentFruitSize = fruitSize;
    this.dropX = fruitX;
    this.settleCheckTimer = 0;

    // 이전 턴의 임시 과일 상태 정리
    if (this.pendingDropFruitId) {
      const tempFruit = this.fruits.get(this.pendingDropFruitId);
      if (tempFruit) {
        Matter.Composite.remove(this.engine.world, tempFruit);
        this.fruits.delete(this.pendingDropFruitId);
      }
      this.pendingDropFruitId = null;
      this.pendingDropSynced = false;
    }
    this.dropEnabled = false;

    // 내 턴이면 타이머 시작 + 1초 뒤 드롭 활성화
    if (this.sync.isMyTurn) {
      console.log('[TurnStart] 내 턴! 타이머 시작');
      this.startTimer();
      this.dropDelayTimer = window.setTimeout(() => {
        this.dropEnabled = true;
        console.log('[TurnStart] 드롭 활성화');
      }, DROP_DELAY_MS);
    }
  }

  private clearDropDelay(): void {
    if (this.dropDelayTimer !== null) {
      clearTimeout(this.dropDelayTimer);
      this.dropDelayTimer = null;
    }
  }

  private handleGameOver(partyScore: number): void {
    this.isRunning = false;
    this.stopTimer();
    this.audio.stopBGM();
    this.audio.playSFX('GAMEOVER');
    this.showGameOverScreen(partyScore);
  }

  // 호스트 전용: 비호스트의 드롭 요청을 받아 실제 발사 수행
  private handleDropRequest(
    playerId: string,
    x: number,
    size: number,
    velocityX: number,
    velocityY: number
  ): void {
    if (!this.sync.isHost) return;

    console.log('[DropRequest] 호스트가 발사 요청 처리:', playerId, 'x:', x, 'size:', size, 'velocity:', velocityX, velocityY);

    // 드롭 프레임 기록
    this.lastDropFrame = this.frameCount;
    this.lastDropPlayerId = playerId; // 합성 점수용

    // 고유 ID 생성
    const fruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    console.log('[DropRequest] 호스트가 과일 발사:', fruitId);

    // 물리 엔진에 과일 생성 (발사 위치와 전달받은 속도)
    this.createFruitWithId(
      fruitId,
      x,
      LAUNCH_Y,
      size,
      { x: velocityX, y: velocityY }
    );

    // 비행 상태로 마크 (충돌 전까지 중력 무시) - 발사 속도 저장
    this.inFlightFruits.set(fruitId, { vx: velocityX, vy: velocityY });

    // Firebase에 과일 동기화 (호스트 권한으로 직접 수행, isMyTurn 체크 없음)
    this.sync.hostAddFruit(fruitId, x, LAUNCH_Y, size);

    // 드롭 요청 삭제
    this.sync.clearDropRequest();

    // 드롭 사운드는 요청한 클라이언트가 이미 재생함
  }

  private startTimer(): void {
    this.stopTimer();
    this.timeRemaining = TURN_TIME;
    this.timerInterval = window.setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        // 타임아웃 시 강제 발사 (기본 속도)
        this.dropEnabled = true;
        this.launchFruit();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private launchFruit(): void {
    console.log('[Launch] 시도 - isMyTurn:', this.sync.isMyTurn, 'turnPhase:', this.turnPhase, 'dropEnabled:', this.dropEnabled, 'isHost:', this.sync.isHost);
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready' || !this.dropEnabled) return;

    this.stopTimer();
    this.clearDropDelay();
    this.turnPhase = 'dropping';
    this.dropEnabled = false;
    this.audio.playSFX('DROP');

    // 드롭 프레임 기록 (3초 후부터 게임오버 체크)
    this.lastDropFrame = this.frameCount;

    // 동적 발사 속도 사용 (당기지 않았으면 기본 속도)
    const velocity = (this.launchVelocity.x !== 0 || this.launchVelocity.y !== 0)
      ? this.launchVelocity
      : { x: 0, y: -MAX_LAUNCH_SPEED * 0.5 }; // 타임아웃 시 중간 속도로 발사

    if (this.sync.isHost) {
      // 호스트: 직접 과일 생성 및 물리 시뮬레이션
      const fruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.droppedFruitId = fruitId;
      this.lastDropPlayerId = this.sync.playerId; // 합성 점수용

      console.log('[Launch] 호스트가 직접 과일 발사:', fruitId, 'x:', this.dropX, 'velocity:', velocity);

      // 발사 위치와 동적 속도로 생성
      this.createFruitWithId(
        fruitId,
        this.dropX,
        LAUNCH_Y,
        this.currentFruitSize,
        velocity
      );
      // 비행 상태로 마크 (충돌 전까지 중력 무시) - 발사 속도 저장
      this.inFlightFruits.set(fruitId, { vx: velocity.x, vy: velocity.y });

      this.turnPhase = 'settling';
      this.settleCheckTimer = 0;

      // Firebase에 과일 동기화 (velocity 포함)
      this.sync.dropFruitWithVelocity(fruitId, this.dropX, LAUNCH_Y, this.currentFruitSize, velocity);
    } else {
      // 비호스트: 드롭 요청 전송 + 로컬 예측 렌더링용 임시 과일 생성
      console.log('[Launch] 비호스트가 발사 요청 전송:', 'x:', this.dropX, 'velocity:', velocity);

      // 로컬 예측 렌더링용 임시 과일 생성 (발사 애니메이션)
      const tempFruitId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.pendingDropFruitId = tempFruitId;
      this.pendingDropSynced = false;
      this.createFruitWithId(
        tempFruitId,
        this.dropX,
        LAUNCH_Y,
        this.currentFruitSize,
        velocity
      );
      // 비행 상태로 마크 (충돌 전까지 중력 무시) - 발사 속도 저장
      this.inFlightFruits.set(tempFruitId, { vx: velocity.x, vy: velocity.y });

      this.turnPhase = 'settling';
      this.settleCheckTimer = 0;

      // 호스트에게 드롭 요청 전송 (velocity 포함)
      this.sync.requestDropWithVelocity(this.dropX, this.currentFruitSize, velocity);
    }

    // 슬링샷 상태 초기화
    this.slingshotPhase = 'idle';
    this.launchVelocity = { x: 0, y: 0 };

    console.log('[Launch] settling 상태로 전환, 타이머 리셋');
  }

  private createFruitWithId(
    id: string,
    x: number,
    y: number,
    size: number,
    initialVelocity?: { x: number; y: number }
  ): Matter.Body {
    const data = FRUIT_DATA[size - 1] || FRUIT_DATA[0];

    const fruit = Matter.Bodies.circle(x, y, data.radius, {
      restitution: 0.4,
      friction: 0.3,
      frictionAir: 0.01,
      density: 0.001,
      label: `${id}_${size}`,
    });

    Matter.Composite.add(this.engine.world, fruit);
    this.fruits.set(id, fruit);

    // 초기 속도 설정 (발사용)
    if (initialVelocity) {
      Matter.Body.setVelocity(fruit, initialVelocity);
    }

    return fruit;
  }

  private removeFruitById(id: string): void {
    const fruit = this.fruits.get(id);
    if (fruit) {
      Matter.Composite.remove(this.engine.world, fruit);
      this.fruits.delete(id);
      // 호스트: 삭제된 과일 ID 기록 (Firebase 동기화 지연으로 인한 재생성 방지)
      if (this.sync.isHost) {
        this.deletedFruitIds.add(id);
      }
    }
  }

  private parseFruitLabel(label: string): { id: string; size: number } | null {
    const lastUnderscore = label.lastIndexOf('_');
    if (lastUnderscore === -1) return null;
    const id = label.substring(0, lastUnderscore);
    const size = parseInt(label.substring(lastUnderscore + 1));
    if (isNaN(size)) return null;
    return { id, size };
  }

  private handleCollision(event: Matter.IEventCollision<Matter.Engine>): void {
    for (const pair of event.pairs) {
      // 충돌한 과일은 비행 상태 해제 (중력 적용 시작) - 모든 클라이언트
      const fruitA = this.parseFruitLabel(pair.bodyA.label);
      const fruitB = this.parseFruitLabel(pair.bodyB.label);

      // 디버깅: 충돌 정보 출력
      const labelA = pair.bodyA.label;
      const labelB = pair.bodyB.label;
      const wasInFlightA = fruitA && this.inFlightFruits.has(fruitA.id);
      const wasInFlightB = fruitB && this.inFlightFruits.has(fruitB.id);
      if (wasInFlightA || wasInFlightB) {
        console.log('[Collision] 비행 중 과일 충돌:', labelA, 'vs', labelB);
      }

      // 벽이나 다른 오브젝트와 충돌 시 비행 상태 해제
      if (fruitA) this.inFlightFruits.delete(fruitA.id);
      if (fruitB) this.inFlightFruits.delete(fruitB.id);

      // 합성 처리는 호스트만
      if (!this.sync.isHost) continue;
      if (!fruitA || !fruitB) continue;
      if (fruitA.size !== fruitB.size) continue;

      const pairKey = [fruitA.id, fruitB.id].sort().join('-');
      if (this.mergedPairs.has(pairKey)) continue;
      this.mergedPairs.add(pairKey);

      setTimeout(() => {
        const bodyA = this.fruits.get(fruitA.id);
        const bodyB = this.fruits.get(fruitB.id);

        if (!bodyA || !bodyB) {
          this.mergedPairs.delete(pairKey);
          return;
        }

        console.log('[Merge] 합성:', fruitA.id, '(size:', fruitA.size, ') +', fruitB.id, '(size:', fruitB.size, ')');

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;
        const newSize = fruitA.size + 1;

        // 두 오브젝트의 속도 벡터 합산 (제거 전에 저장)
        const avgVx = (bodyA.velocity.x + bodyB.velocity.x) * 0.5;
        const avgVy = (bodyA.velocity.y + bodyB.velocity.y) * 0.5;

        // 속도 크기에 비례해서 튕김 (느리게 부딪히면 거의 안 튕김)
        const combinedVelocity = {
          x: avgVx * MERGE_BOUNCE_MULTIPLIER,
          y: avgVy * MERGE_BOUNCE_MULTIPLIER,
        };

        // 기존 과일 제거
        this.removeFruitById(fruitA.id);
        this.removeFruitById(fruitB.id);

        // 합체 사운드
        this.audio.playSFX('MERGE');

        // 크기 10이면 폭죽 효과 후 사라짐
        if (newSize >= MAX_FRUIT_SIZE) {
          this.createFirework(midX, midY);
          this.applyExplosionForce(midX, midY); // 주변 공들에게 충격파

          // 점수 추가 (크기 10 보너스) - 마지막 드롭한 플레이어에게
          const scoreGain = FRUIT_DATA[MAX_FRUIT_SIZE - 1]?.score || 0;

          // 최대 크기 업데이트
          if (MAX_FRUIT_SIZE > this.maxFruitSize) {
            this.maxFruitSize = MAX_FRUIT_SIZE;
          }

          // 드롭한 과일이 합쳐져서 사라졌으면 null로
          if (this.droppedFruitId === fruitA.id || this.droppedFruitId === fruitB.id) {
            this.droppedFruitId = null;
          }

          // 마지막 드롭한 플레이어에게 점수 부여
          const room = this.sync.room;
          if (room && this.lastDropPlayerId) {
            const newPartyScore = room.partyScore + scoreGain;
            this.sync.reportPlayerScore(this.lastDropPlayerId, scoreGain, newPartyScore);
          }
        } else {
          // 새 과일 생성 (두 오브젝트의 속도 벡터 합산 방향으로 튕김)
          const newFruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          this.createFruitWithId(newFruitId, midX, midY, newSize, combinedVelocity);

          // 점수 추가 - 마지막 드롭한 플레이어에게
          const scoreGain = FRUIT_DATA[newSize - 1]?.score || 0;

          // 최대 크기 업데이트
          if (newSize > this.maxFruitSize) {
            this.maxFruitSize = newSize;
          }

          // 드롭한 과일이 합쳐졌으면 새 과일로 교체
          if (this.droppedFruitId === fruitA.id || this.droppedFruitId === fruitB.id) {
            this.droppedFruitId = newFruitId;
          }

          // 마지막 드롭한 플레이어에게 점수 부여
          const room = this.sync.room;
          if (room && this.lastDropPlayerId) {
            const newPartyScore = room.partyScore + scoreGain;
            this.sync.reportPlayerScore(this.lastDropPlayerId, scoreGain, newPartyScore);
          }
        }

        this.mergedPairs.delete(pairKey);

        // 즉시 동기화
        this.syncFruitsToServer();
      }, 0);
    }
  }

  // 과일이 게임오버 라인 위에 있는지 확인 (즉시 판정 아님)
  private checkFruitsOverLine(): boolean {
    for (const [, fruit] of this.fruits) {
      const parsed = this.parseFruitLabel(fruit.label);
      if (!parsed) continue;
      const radius = FRUIT_DATA[parsed.size - 1]?.radius || 15;
      // 과일의 하단이 게임오버 라인 아래에 있고, 속도가 거의 없을 때만
      const speed = Math.sqrt(fruit.velocity.x ** 2 + fruit.velocity.y ** 2);
      if (fruit.position.y + radius > GAME_OVER_Y && speed < 2) {
        return true;
      }
    }
    return false;
  }

  // 게임오버 타이머 업데이트 (호스트만)
  private updateGameOverCheck(): void {
    if (!this.sync.isHost) return;

    const overLine = this.checkFruitsOverLine();
    const framesSinceLastDrop = this.frameCount - this.lastDropFrame;
    const graceActive = framesSinceLastDrop < DROP_GRACE_FRAMES;

    if (overLine) {
      // 선 위에 오브젝트가 있음
      if (this.gameOverTimer > 0) {
        // 이미 카운트다운 진행중이면 계속 (새 드롭과 무관하게)
        this.gameOverTimer++;
        this.isOverLine = true;
      } else if (!graceActive) {
        // 카운트다운 시작 (3초 유예 기간 지난 후에만)
        this.gameOverTimer = 1;
        this.isOverLine = true;
      }
      // graceActive && gameOverTimer === 0 이면 아직 유예 기간이므로 카운트다운 시작 안함

      // 게임오버 체크
      if (this.gameOverTimer >= GAME_OVER_CHECK_FRAMES) {
        console.log('[GameOver] 2초 동안 라인 위에 있어서 게임오버');
        this.sync.reportGameOver();
      }
    } else {
      // 선 위로 올라가면 카운트다운 종료 (중력이 위쪽이라 안전)
      this.gameOverTimer = 0;
      this.isOverLine = false;
    }
  }

  // 폭죽 효과 생성
  private createFirework(x: number, y: number): void {
    const colors = ['#FFD700', '#FF6B6B', '#4BC0C0', '#FF8E53', '#9966FF', '#36A2EB', '#FF6384'];
    const particleCount = 50;

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
      const speed = 3 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 60 + Math.random() * 30,
        maxLife: 90,
        size: 3 + Math.random() * 4,
      });
    }
  }

  // 폭발 충격파 적용 (주변 공들을 밀어냄)
  private applyExplosionForce(centerX: number, centerY: number): void {
    for (const [_id, body] of this.fruits) {
      const dx = body.position.x - centerX;
      const dy = body.position.y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 충격파 범위 내의 공들에게만 적용
      if (distance > 0 && distance < EXPLOSION_RADIUS) {
        // 거리에 반비례하는 힘 (가까울수록 강함)
        const forceMagnitude = EXPLOSION_FORCE * (1 - distance / EXPLOSION_RADIUS);

        // 방향 정규화
        const forceX = (dx / distance) * forceMagnitude;
        const forceY = (dy / distance) * forceMagnitude;

        // 힘 적용
        Matter.Body.applyForce(body, body.position, { x: forceX, y: forceY });
      }
    }
  }

  // 파티클 업데이트
  private updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // 중력
      p.vx *= 0.98; // 마찰
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  // 파티클 렌더링
  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 별 렌더링
  private renderStars(ctx: CanvasRenderingContext2D): void {
    const stars = [
      { x: 30, y: 40, size: 1.5 }, { x: 80, y: 25, size: 1 },
      { x: 150, y: 50, size: 2 }, { x: 200, y: 30, size: 1 },
      { x: 250, y: 60, size: 1.5 }, { x: 320, y: 35, size: 1 },
      { x: 370, y: 55, size: 2 }, { x: 50, y: 80, size: 1 },
      { x: 120, y: 70, size: 1.5 }, { x: 280, y: 75, size: 1 },
      { x: 350, y: 85, size: 1.5 }, { x: 180, y: 90, size: 1 },
    ];

    const twinkle = Math.sin(this.frameCount * 0.05) * 0.3 + 0.7;

    for (const star of stars) {
      ctx.globalAlpha = twinkle + Math.sin(star.x * 0.1 + this.frameCount * 0.03) * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 도시 실루엣 렌더링
  private renderCitySkyline(ctx: CanvasRenderingContext2D): void {
    const skylineY = HEIGHT - 80;

    // 뒷줄 건물 (어둡게)
    ctx.fillStyle = '#151525';
    const backBuildings = [
      { x: 0, w: 40, h: 60 }, { x: 35, w: 30, h: 80 },
      { x: 60, w: 45, h: 50 }, { x: 100, w: 35, h: 70 },
      { x: 130, w: 50, h: 55 }, { x: 175, w: 40, h: 75 },
      { x: 210, w: 45, h: 60 }, { x: 250, w: 35, h: 85 },
      { x: 280, w: 50, h: 50 }, { x: 325, w: 40, h: 70 },
      { x: 360, w: 45, h: 65 },
    ];
    for (const b of backBuildings) {
      ctx.fillRect(b.x, skylineY - b.h + 20, b.w, b.h);
    }

    // 앞줄 건물
    ctx.fillStyle = '#1a1a2e';
    const frontBuildings = [
      { x: 10, w: 35, h: 50 }, { x: 50, w: 25, h: 65 },
      { x: 80, w: 40, h: 45 }, { x: 125, w: 30, h: 60 },
      { x: 160, w: 45, h: 40 }, { x: 200, w: 35, h: 70 },
      { x: 240, w: 40, h: 55 }, { x: 285, w: 30, h: 75 },
      { x: 320, w: 45, h: 45 }, { x: 365, w: 35, h: 60 },
    ];
    for (const b of frontBuildings) {
      ctx.fillRect(b.x, skylineY - b.h + 30, b.w, b.h + 50);
    }

    // 창문 불빛 (고정 패턴 사용)
    ctx.fillStyle = '#ffcc0066';
    for (let bi = 0; bi < frontBuildings.length; bi++) {
      const b = frontBuildings[bi];
      const pattern = this.windowPattern[bi] || [];
      const windowRows = Math.floor(b.h / 12);
      const windowCols = Math.floor(b.w / 10);
      let idx = 0;
      for (let row = 0; row < windowRows; row++) {
        for (let col = 0; col < windowCols; col++) {
          if (pattern[idx]) {
            const wx = b.x + 5 + col * 10;
            const wy = skylineY - b.h + 35 + row * 12;
            ctx.fillRect(wx, wy, 4, 6);
          }
          idx++;
        }
      }
    }
  }

  private async nextTurn(): Promise<void> {
    console.log('[NextTurn] 호출됨 - isHost:', this.sync.isHost, 'isMyTurn:', this.sync.isMyTurn);

    // 게임오버는 게임 루프에서 타이머 기반으로 검사하므로 여기서는 체크하지 않음

    // 다음 과일 크기 결정 (확률 시스템)
    const nextSize = this.getNextFruitSize();

    console.log('[NextTurn] 다음 과일 크기:', nextSize, '서버 요청 중...');

    // 서버에 다음 턴 요청 (현재 턴 플레이어만)
    if (this.sync.isMyTurn) {
      await this.sync.nextTurn(nextSize);
      console.log('[NextTurn] 서버 요청 완료');
    }
  }

  // 다음 과일 크기 결정 (작은 크기일수록 높은 확률)
  private getNextFruitSize(): number {
    // 스폰 가능 최대 크기: maxFruitSize - 1 (최소 1, 최대 5)
    const maxSpawn = Math.min(Math.max(1, this.maxFruitSize - 1), 5);

    if (maxSpawn === 1) return 1;

    // 각 크기별 가중치 계산 (작을수록 높음)
    // 크기 1: 가중치 maxSpawn, 크기 2: 가중치 maxSpawn-1, ...
    const weights: number[] = [];
    for (let size = 1; size <= maxSpawn; size++) {
      const weight = maxSpawn - size + 1;
      weights.push(weight);
    }

    // 가중치 합계
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    // 랜덤 선택
    let random = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return i + 1;
      }
    }

    return 1;
  }

  private syncFruitsToServer(): void {
    if (!this.sync.isHost) return;

    const fruitsData: Record<string, { x: number; y: number; size: number }> = {};

    // 호스트의 로컬 과일 (물리 엔진 위치)
    for (const [id, body] of this.fruits) {
      const parsed = this.parseFruitLabel(body.label);
      if (parsed) {
        fruitsData[id] = {
          x: Math.round(body.position.x),
          y: Math.round(body.position.y),
          size: parsed.size,
        };
      }
    }

    // 삭제된 과일 목록 (Firebase에서도 삭제)
    const deletedIds = Array.from(this.deletedFruitIds);

    // update()를 사용하므로 비호스트 과일은 자동으로 보존됨
    this.sync.syncAllFruits(fruitsData, deletedIds);

    // sync 후 deletedFruitIds 정리 (이미 Firebase에 반영됨)
    this.deletedFruitIds.clear();
  }

  private showGameOverScreen(partyScore: number): void {
    const room = this.sync.room;
    if (!room) return;

    const players = Object.values(room.players) as RoomPlayer[];
    players.sort((a, b) => b.score - a.score);

    const playerCount = players.length;
    const multiplier = this.getPlayerMultiplier(playerCount);
    const finalScore = Math.floor(partyScore * multiplier);

    const style = document.createElement('style');
    style.textContent = `
      .game-over-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .game-over-content {
        background: linear-gradient(135deg, #1a1a2e, #2a1a4a);
        padding: 40px 50px;
        border-radius: 20px;
        text-align: center;
        color: white;
        border: 3px solid #ff6b9d;
        box-shadow: 0 0 50px rgba(255, 107, 157, 0.4);
        min-width: 360px;
        max-width: 450px;
      }
      .game-over-title {
        font-size: 42px;
        background: linear-gradient(135deg, #ff6b9d, #ffcc00, #ff6b9d);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 30px;
        opacity: 0;
        transform: scale(0.5);
        animation: popIn 0.6s ease-out forwards;
      }
      @keyframes popIn {
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes countUp {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes glowPulse {
        0%, 100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.5); }
        50% { box-shadow: 0 0 25px rgba(255, 215, 0, 0.8); }
      }
      .score-phase {
        margin: 20px 0;
        opacity: 0;
        transform: translateY(20px);
      }
      .score-phase.visible {
        animation: fadeSlideIn 0.5s ease-out forwards;
      }
      .phase-title {
        font-size: 14px;
        color: #888;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 2px;
      }
      .player-contribution {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
        margin: 6px 0;
        background: rgba(255,255,255,0.05);
        border-radius: 10px;
        border-left: 3px solid #4BC0C0;
        opacity: 0;
        transform: translateX(-20px);
      }
      .player-contribution.visible {
        animation: fadeSlideIn 0.4s ease-out forwards;
      }
      .player-contribution.top-1 { border-left-color: #FFD700; }
      .player-contribution.top-2 { border-left-color: #C0C0C0; }
      .player-contribution.top-3 { border-left-color: #CD7F32; }
      .player-name { font-weight: bold; }
      .player-score { color: #4BC0C0; font-weight: bold; }
      .total-score {
        font-size: 36px;
        color: #fff;
        margin: 10px 0;
      }
      .multiplier-display {
        display: inline-block;
        padding: 8px 20px;
        background: linear-gradient(135deg, #ff6b9d, #ff9a56);
        border-radius: 20px;
        font-size: 18px;
        font-weight: bold;
        margin: 10px 0;
      }
      .final-score-container {
        margin: 20px 0;
        padding: 20px;
        background: rgba(255, 215, 0, 0.1);
        border-radius: 15px;
        border: 2px solid #FFD700;
      }
      .final-score-container.visible {
        animation: glowPulse 1.5s ease-in-out infinite;
      }
      .final-score-label {
        font-size: 16px;
        color: #FFD700;
        margin-bottom: 5px;
      }
      .final-score-value {
        font-size: 48px;
        font-weight: bold;
        background: linear-gradient(135deg, #FFD700, #FFA500);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .top-contributors {
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }
      .top-contributor-item {
        display: inline-block;
        margin: 5px 8px;
        padding: 8px 15px;
        background: rgba(255,255,255,0.1);
        border-radius: 20px;
        font-size: 14px;
      }
      .medal { margin-right: 5px; }
      .play-again-btn {
        margin-top: 25px;
        padding: 14px 40px;
        font-size: 18px;
        font-weight: bold;
        border: none;
        border-radius: 30px;
        background: linear-gradient(135deg, #ff6b9d, #ff9a56);
        color: white;
        cursor: pointer;
        opacity: 0;
        transition: transform 0.2s, box-shadow 0.2s;
        box-shadow: 0 4px 20px rgba(255, 107, 157, 0.4);
      }
      .play-again-btn.visible {
        animation: fadeSlideIn 0.5s ease-out forwards;
      }
      .play-again-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 30px rgba(255, 107, 157, 0.6);
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML = `
      <div class="game-over-content">
        <h1 class="game-over-title">Game Over!</h1>

        <div class="score-phase" id="phase-contributions">
          <div class="phase-title">Player Contributions</div>
          <div id="contributions-list"></div>
        </div>

        <div class="score-phase" id="phase-total">
          <div class="phase-title">Total Party Score</div>
          <div class="total-score" id="total-score-value">0</div>
        </div>

        <div class="score-phase" id="phase-multiplier">
          <div class="phase-title">${playerCount} Players Bonus</div>
          <div class="multiplier-display">x${multiplier.toFixed(1)}</div>
        </div>

        <div class="score-phase" id="phase-final">
          <div class="final-score-container">
            <div class="final-score-label">Final Score</div>
            <div class="final-score-value" id="final-score-value">0</div>
          </div>
          <div class="top-contributors" id="top-contributors"></div>
        </div>

        <button class="play-again-btn" id="play-again-btn" onclick="location.reload()">Play Again</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // 연출 시퀀스 시작
    this.runScoreAnimation(players, partyScore, multiplier, finalScore);
  }

  private getPlayerMultiplier(playerCount: number): number {
    // 인원 범위: 1~10명
    const clampedCount = Math.max(1, Math.min(10, playerCount));

    // 로그 기반 배율: 1명 = x1.0, 10명 = x2.0 (증가폭 점점 감소)
    // 공식: 1 + ln(n) / ln(10)
    if (clampedCount === 1) return 1.0;
    return 1 + Math.log(clampedCount) / Math.log(10);
  }

  private async runScoreAnimation(
    players: RoomPlayer[],
    partyScore: number,
    _multiplier: number,
    finalScore: number
  ): Promise<void> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Phase 1: 플레이어별 기여 점수 공개
    await delay(800);
    const phase1 = document.getElementById('phase-contributions');
    const contributionsList = document.getElementById('contributions-list');
    if (phase1 && contributionsList) {
      phase1.classList.add('visible');

      for (let i = 0; i < players.length; i++) {
        await delay(400);
        const player = players[i];
        const topClass = i === 0 ? 'top-1' : i === 1 ? 'top-2' : i === 2 ? 'top-3' : '';
        const item = document.createElement('div');
        item.className = `player-contribution ${topClass}`;
        item.innerHTML = `
          <span class="player-name">${player.name}</span>
          <span class="player-score">+${player.score.toLocaleString()}</span>
        `;
        contributionsList.appendChild(item);
        setTimeout(() => item.classList.add('visible'), 50);
        this.audio.playSFX('CLICK');
      }
    }

    // Phase 2: 총 합산 점수
    await delay(600);
    const phase2 = document.getElementById('phase-total');
    const totalScoreEl = document.getElementById('total-score-value');
    if (phase2 && totalScoreEl) {
      phase2.classList.add('visible');
      await this.animateNumber(totalScoreEl, 0, partyScore, 1000);
      this.audio.playSFX('MERGE');
    }

    // Phase 3: 인원 배율 적용
    await delay(500);
    const phase3 = document.getElementById('phase-multiplier');
    if (phase3) {
      phase3.classList.add('visible');
      this.audio.playSFX('DROP');
    }

    // Phase 4: 최종 점수
    await delay(800);
    const phase4 = document.getElementById('phase-final');
    const finalScoreEl = document.getElementById('final-score-value');
    const topContributors = document.getElementById('top-contributors');
    const finalContainer = phase4?.querySelector('.final-score-container');

    if (phase4 && finalScoreEl && topContributors) {
      phase4.classList.add('visible');
      await this.animateNumber(finalScoreEl, 0, finalScore, 1500);
      finalContainer?.classList.add('visible');
      this.audio.playSFX('MERGE');

      // Top 3 표시
      await delay(500);
      const medals = ['🥇', '🥈', '🥉'];
      const top3 = players.slice(0, 3);
      topContributors.innerHTML = '<div class="phase-title">Top Contributors</div>' +
        top3.map((p, i) => `
          <span class="top-contributor-item">
            <span class="medal">${medals[i]}</span>${p.name}
          </span>
        `).join('');
    }

    // Play Again 버튼 표시
    await delay(600);
    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
      playAgainBtn.classList.add('visible');
    }
  }

  private animateNumber(element: HTMLElement, start: number, end: number, duration: number): Promise<void> {
    return new Promise(resolve => {
      const startTime = performance.now();
      const update = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // easeOutExpo
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const current = Math.floor(start + (end - start) * eased);

        element.textContent = current.toLocaleString();

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(update);
    });
  }

  private gameLoop = (): void => {
    if (!this.isRunning) return;

    this.frameCount++;

    // 비행 중인 과일: 중력 무시하고 직선 비행
    // 방법: 저장된 발사 속도를 매 프레임 직접 적용
    for (const [fruitId, storedVelocity] of this.inFlightFruits.entries()) {
      const body = this.fruits.get(fruitId);
      if (body) {
        // 화면 경계 체크 - 벽에 닿으면 비행 상태 해제
        const { x, y } = body.position;
        const parsed = this.parseFruitLabel(body.label);
        const radius = parsed ? FRUIT_DATA[parsed.size - 1]?.radius || 15 : 15;

        if (x - radius <= 5 || x + radius >= WIDTH - 5 ||
            y - radius <= CEILING_Y + 5 || y + radius >= HEIGHT - 5) {
          console.log('[Flight] 경계 도달, 비행 상태 해제:', fruitId, 'pos:', x, y);
          this.inFlightFruits.delete(fruitId);
          continue;
        }

        // 비행 중에는 저장된 발사 속도를 직접 적용 (중력 무시)
        Matter.Body.setVelocity(body, {
          x: storedVelocity.vx,
          y: storedVelocity.vy
        });
      }
    }

    // 호스트: 전체 물리 시뮬레이션
    // 비호스트: 임시 과일 물리 시뮬레이션 (예측 렌더링용)
    if (this.sync.isHost) {
      Matter.Engine.update(this.engine, 1000 / 60);

      // 주기적으로 과일 위치 동기화
      if (this.frameCount % SYNC_INTERVAL === 0) {
        this.syncFruitsToServer();
      }

      // 게임오버 검사 (2초 동안 라인 위에 있으면 게임오버)
      this.updateGameOverCheck();
    } else if (this.pendingDropFruitId && !this.pendingDropSynced) {
      // 비호스트: 임시 과일이 있고 아직 동기화되지 않았을 때만 물리 업데이트
      Matter.Engine.update(this.engine, 1000 / 60);
    }

    // settling 상태에서 안정화 체크 (내 턴일 때)
    if (this.turnPhase === 'settling' && this.sync.isMyTurn) {
      this.settleCheckTimer++;
      // 거의 즉시 다음 턴으로
      if (this.settleCheckTimer > SETTLE_FRAMES) {
        console.log('[Settle] 안정화 완료, 다음 턴으로');
        this.settleCheckTimer = 0;
        this.turnPhase = 'waiting';
        this.nextTurn();
      }
    }

    // 파티클 업데이트
    this.updateParticles();

    // 렌더링
    this.render();

    requestAnimationFrame(this.gameLoop);
  };

  private render(): void {
    const ctx = this.ctx;

    // 배경 - 밤하늘 그라데이션
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#0a0a1a');
    gradient.addColorStop(0.4, '#1a1a3a');
    gradient.addColorStop(0.7, '#2a1a4a');
    gradient.addColorStop(1, '#1a1a3a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 별 그리기
    this.renderStars(ctx);

    // 도시 실루엣
    this.renderCitySkyline(ctx);

    // 벽 (도시 테마)
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
    ctx.fillStyle = 'rgba(50, 30, 70, 0.8)';
    ctx.fillRect(0, 0, 4, HEIGHT);
    ctx.fillRect(WIDTH - 4, 0, 4, HEIGHT);

    // 게임오버 라인 (불꽃놀이 테마)
    ctx.strokeStyle = '#ff6b9d';
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GAME_OVER_Y);
    ctx.lineTo(WIDTH, GAME_OVER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // 슬링샷 시각화 (ready 상태일 때)
    if (this.turnPhase === 'ready' && this.sync.isMyTurn) {
      this.renderSlingshotUI(ctx);
    }

    // 파티클 그리기 (폭죽 효과)
    this.renderParticles(ctx);

    // 과일 그리기 (호스트는 로컬 물리, 비호스트는 원격 상태)
    if (this.sync.isHost) {
      this.renderLocalFruits(ctx);
    } else {
      this.renderRemoteFruits(ctx);
    }

    // UI
    this.renderUI();
  }

  private renderLocalFruits(ctx: CanvasRenderingContext2D): void {
    // 디버깅: 과일 개수 및 위치 확인
    if (this.frameCount % 60 === 0 && this.fruits.size > 0) {
      for (const [id, fruit] of this.fruits) {
        console.log('[Render] 과일:', id.substring(0, 20), 'pos:', Math.round(fruit.position.x), Math.round(fruit.position.y));
      }
    }

    for (const [, fruit] of this.fruits) {
      const { x, y } = fruit.position;
      const parsed = this.parseFruitLabel(fruit.label);
      if (!parsed) continue;

      const data = FRUIT_DATA[parsed.size - 1] || FRUIT_DATA[0];

      ctx.beginPath();
      ctx.arc(x, y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(parsed.size.toString(), x, y);
    }
  }

  private renderRemoteFruits(ctx: CanvasRenderingContext2D): void {
    // 1. 임시 과일 렌더링 (아직 동기화되지 않은 경우, 로컬 물리 엔진 위치 사용)
    if (this.pendingDropFruitId && !this.pendingDropSynced) {
      const tempFruit = this.fruits.get(this.pendingDropFruitId);
      if (tempFruit) {
        const { x, y } = tempFruit.position;
        const parsed = this.parseFruitLabel(tempFruit.label);
        if (parsed) {
          const data = FRUIT_DATA[parsed.size - 1] || FRUIT_DATA[0];

          ctx.beginPath();
          ctx.arc(x, y, data.radius, 0, Math.PI * 2);
          ctx.fillStyle = data.color;
          ctx.fill();
          ctx.strokeStyle = '#ffffff44';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(parsed.size.toString(), x, y);
        }
      }
    }

    // 2. Firebase에서 받은 과일 상태 렌더링
    for (const [, fruitState] of Object.entries(this.remoteFruits)) {
      const data = FRUIT_DATA[fruitState.size - 1] || FRUIT_DATA[0];

      ctx.beginPath();
      ctx.arc(fruitState.x, fruitState.y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fruitState.size.toString(), fruitState.x, fruitState.y);
    }
  }

  private renderUI(): void {
    const ctx = this.ctx;
    const room = this.sync.room;

    // === UI는 상단 영역에 표시 (천장 위, 오브젝트와 겹치지 않음) ===
    const UI_TOP = 8; // 상단 여백

    // UI 영역 배경 (반투명)
    ctx.fillStyle = 'rgba(10, 10, 26, 0.8)';
    ctx.fillRect(0, 0, WIDTH, UI_AREA_HEIGHT);

    // UI 영역 하단 경계선
    ctx.strokeStyle = 'rgba(255, 107, 157, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, UI_AREA_HEIGHT);
    ctx.lineTo(WIDTH, UI_AREA_HEIGHT);
    ctx.stroke();

    // 점수 (상단 좌측)
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Party: ${room?.partyScore || 0}`, 10, UI_TOP);
    const myScore = room?.players[this.sync.playerId]?.score || 0;
    ctx.fillText(`My: ${myScore}`, 10, UI_TOP + 18);

    // 호스트 표시
    if (this.sync.isHost) {
      ctx.fillStyle = '#4BC0C0';
      ctx.fillText('(Host)', 10, UI_TOP + 36);
    }

    // 현재 턴 플레이어 (상단 중앙)
    if (room) {
      const currentPlayerId = room.playerOrder[room.currentPlayerIndex];
      const currentPlayer = room.players[currentPlayerId];
      const isMyTurn = this.sync.isMyTurn;

      ctx.textAlign = 'center';
      ctx.fillStyle = isMyTurn ? '#4BC0C0' : '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(isMyTurn ? 'Your Turn!' : `${currentPlayer?.name || 'Unknown'}'s Turn`, WIDTH / 2, UI_TOP);
    }

    // 타이머 (상단 중앙, 턴 표시 아래)
    if (this.turnPhase === 'ready' && this.sync.isMyTurn) {
      ctx.textAlign = 'center';
      ctx.fillStyle = this.timeRemaining <= 3 ? '#e94560' : 'rgba(233, 69, 96, 0.8)';
      ctx.beginPath();
      ctx.roundRect(WIDTH / 2 - 20, UI_TOP + 20, 40, 28, 6);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px Arial';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this.timeRemaining}`, WIDTH / 2, UI_TOP + 34);
    }

    // Waiting 표시 (settling)
    if (this.turnPhase === 'settling') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFCD56';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('Settling...', WIDTH / 2, UI_TOP + 22);
    }

    // 게임오버 경고 표시 (라인 바로 위)
    if (this.isOverLine && this.gameOverTimer > 0) {
      const remainingTime = Math.ceil((GAME_OVER_CHECK_FRAMES - this.gameOverTimer) / 60);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e94560';
      ctx.font = 'bold 16px Arial';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`WARNING! ${remainingTime}s`, WIDTH / 2, GAME_OVER_Y - 10);
    }

    // 플레이어 목록 (상단 우측)
    if (room) {
      const players = Object.values(room.players) as RoomPlayer[];
      players.sort((a, b) => b.score - a.score);

      ctx.textAlign = 'right';
      ctx.font = '11px Arial';
      ctx.textBaseline = 'top';

      // 최대 4명까지 표시
      const displayPlayers = players.slice(0, 4);
      displayPlayers.forEach((player, i) => {
        const isCurrentTurn = room.playerOrder[room.currentPlayerIndex] === player.id;
        const hostMark = player.isHost ? '*' : '';
        const medal = i === 0 ? '1.' : i === 1 ? '2.' : i === 2 ? '3.' : `${i + 1}.`;
        ctx.fillStyle = isCurrentTurn ? '#4BC0C0' : '#aaa';
        ctx.fillText(`${medal}${hostMark}${player.name}: ${player.score}`, WIDTH - 10, UI_TOP + i * 14);
      });
    }
  }

  start(): void {
    this.isRunning = true;
    this.audio.playBGM('MAIN');
    this.gameLoop();

    // 이미 playing 상태면 바로 시작
    const room = this.sync.room;
    if (room && room.status === 'playing') {
      this.handleGameStart();
    }
  }

  stop(): void {
    this.isRunning = false;
    this.stopTimer();
    this.audio.stopBGM();
  }
}
