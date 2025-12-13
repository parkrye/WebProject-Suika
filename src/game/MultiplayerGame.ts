import Matter from 'matter-js';
import { GameSync, type GameSyncEvent } from '../network/GameSync';
import type { RoomPlayer, FruitState } from '../network/types';
import { FRUIT_DATA, MAX_FRUIT_SIZE, SETTLE_FRAMES } from '../core/config';

const WIDTH = 400;
const HEIGHT = 600;
const DROP_Y = 80;
const GAME_OVER_Y = 100;
const TURN_TIME = 10;
const SYNC_INTERVAL = 5; // 호스트가 몇 프레임마다 동기화할지
const GAME_OVER_CHECK_FRAMES = 120; // 게임오버 판정까지 2초 (60fps * 2)

type TurnPhase = 'waiting' | 'ready' | 'dropping' | 'settling';

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
  private score = 0;
  private maxFruitSize = 1;
  private isRunning = false;

  // 턴 상태
  private turnPhase: TurnPhase = 'waiting';
  private dropX = WIDTH / 2;
  private currentFruitSize = 1;
  private droppedFruitId: string | null = null;

  // 타이머
  private timeRemaining = TURN_TIME;
  private timerInterval: number | null = null;

  // 이동
  private moveInterval: number | null = null;
  private readonly MOVE_SPEED = 3;

  // 충돌 처리
  private mergedPairs = new Set<string>();
  private settleCheckTimer = 0;
  private frameCount = 0;

  // Firebase에서 받은 과일 상태 (비호스트용)
  private remoteFruits: Record<string, FruitState> = {};

  // 폭죽 파티클 시스템
  private particles: Particle[] = [];

  // 게임오버 판정 타이머
  private gameOverTimer = 0;
  private isOverLine = false;

  // 도시 창문 패턴 (고정)
  private windowPattern: boolean[][] = [];

  constructor(canvas: HTMLCanvasElement, sync: GameSync) {
    this.ctx = canvas.getContext('2d')!;
    this.sync = sync;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    // Matter.js 엔진 생성 (호스트만 실제로 물리 계산)
    this.engine = Matter.Engine.create();
    this.engine.world.gravity.y = 1;

    // 벽 생성
    const walls = [
      Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + 10, WIDTH + 40, 20, { isStatic: true, label: 'floor' }),
      Matter.Bodies.rectangle(-10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(WIDTH + 10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
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
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const btnDrop = document.getElementById('btn-drop');

    if (btnLeft) {
      btnLeft.addEventListener('pointerdown', (e) => { e.preventDefault(); this.startMoving('left'); });
      btnLeft.addEventListener('pointerup', () => this.stopMoving());
      btnLeft.addEventListener('pointerleave', () => this.stopMoving());
    }

    if (btnRight) {
      btnRight.addEventListener('pointerdown', (e) => { e.preventDefault(); this.startMoving('right'); });
      btnRight.addEventListener('pointerup', () => this.stopMoving());
      btnRight.addEventListener('pointerleave', () => this.stopMoving());
    }

    if (btnDrop) {
      btnDrop.addEventListener('click', () => this.dropFruit());
    }
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

    // 호스트가 아니면 Firebase 상태를 로컬 물리에 반영
    if (!this.sync.isHost) {
      this.syncFruitsFromRemote();
    }
  }

  private syncFruitsFromRemote(): void {
    const remoteIds = new Set(Object.keys(this.remoteFruits));

    // 원격에 없는 로컬 과일 제거
    for (const [id, body] of this.fruits) {
      if (!remoteIds.has(id)) {
        Matter.Composite.remove(this.engine.world, body);
        this.fruits.delete(id);
      }
    }

    // 원격 과일 생성 또는 위치 업데이트
    for (const [id, fruitState] of Object.entries(this.remoteFruits)) {
      const existingBody = this.fruits.get(id);
      if (existingBody) {
        // 위치 업데이트 (부드럽게 보간)
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
    this.turnPhase = 'ready';
    this.currentFruitSize = fruitSize;
    this.dropX = fruitX;
    this.droppedFruitId = null;
    this.settleCheckTimer = 0;

    // 내 턴이면 타이머 시작
    if (this.sync.isMyTurn) {
      console.log('[TurnStart] 내 턴! 타이머 시작');
      this.startTimer();
    }
  }

  private handleGameOver(partyScore: number): void {
    this.isRunning = false;
    this.stopTimer();
    this.showGameOverScreen(partyScore);
  }

  private startMoving(direction: 'left' | 'right'): void {
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready' || this.moveInterval) return;
    this.moveOnce(direction);
    this.moveInterval = window.setInterval(() => this.moveOnce(direction), 16);
  }

  private stopMoving(): void {
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
  }

  private moveOnce(direction: 'left' | 'right'): void {
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready') return;
    const radius = FRUIT_DATA[this.currentFruitSize - 1].radius;
    if (direction === 'left') {
      this.dropX = Math.max(radius + 4, this.dropX - this.MOVE_SPEED);
    } else {
      this.dropX = Math.min(WIDTH - radius - 4, this.dropX + this.MOVE_SPEED);
    }
  }

  private startTimer(): void {
    this.stopTimer();
    this.timeRemaining = TURN_TIME;
    this.timerInterval = window.setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        this.dropFruit();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private dropFruit(): void {
    console.log('[Drop] 시도 - isMyTurn:', this.sync.isMyTurn, 'turnPhase:', this.turnPhase);
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready') return;

    this.stopTimer();
    this.turnPhase = 'dropping';

    // 고유 ID 생성
    const fruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.droppedFruitId = fruitId;

    console.log('[Drop] 과일 생성:', fruitId, 'x:', this.dropX, 'size:', this.currentFruitSize);

    // 과일 생성
    this.createFruitWithId(fruitId, this.dropX, DROP_Y, this.currentFruitSize);
    this.turnPhase = 'settling';
    this.settleCheckTimer = 0;

    console.log('[Drop] settling 상태로 전환, 타이머 리셋');

    // 서버에 드롭 알림
    this.sync.dropFruit(fruitId, this.dropX, DROP_Y, this.currentFruitSize);
  }

  private createFruitWithId(id: string, x: number, y: number, size: number): Matter.Body {
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
    return fruit;
  }

  private removeFruitById(id: string): void {
    const fruit = this.fruits.get(id);
    if (fruit) {
      Matter.Composite.remove(this.engine.world, fruit);
      this.fruits.delete(id);
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
    // 호스트만 충돌 처리
    if (!this.sync.isHost) return;

    for (const pair of event.pairs) {
      const fruitA = this.parseFruitLabel(pair.bodyA.label);
      const fruitB = this.parseFruitLabel(pair.bodyB.label);

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

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;
        const newSize = fruitA.size + 1;

        // 기존 과일 제거
        this.removeFruitById(fruitA.id);
        this.removeFruitById(fruitB.id);

        // 크기 10이면 폭죽 효과 후 사라짐
        if (newSize >= MAX_FRUIT_SIZE) {
          this.createFirework(midX, midY);

          // 점수 추가 (크기 10 보너스)
          const scoreGain = FRUIT_DATA[MAX_FRUIT_SIZE - 1]?.score || 0;
          this.score += scoreGain;

          // 최대 크기 업데이트
          if (MAX_FRUIT_SIZE > this.maxFruitSize) {
            this.maxFruitSize = MAX_FRUIT_SIZE;
          }

          // 드롭한 과일이 합쳐져서 사라졌으면 null로
          if (this.droppedFruitId === fruitA.id || this.droppedFruitId === fruitB.id) {
            this.droppedFruitId = null;
          }

          // 서버에 점수 보고
          const room = this.sync.room;
          if (room) {
            const newPartyScore = room.partyScore + scoreGain;
            this.sync.reportScore(this.score, newPartyScore);
          }
        } else {
          // 새 과일 생성
          const newFruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          this.createFruitWithId(newFruitId, midX, midY, newSize);

          // 점수 추가
          const scoreGain = FRUIT_DATA[newSize - 1]?.score || 0;
          this.score += scoreGain;

          // 최대 크기 업데이트
          if (newSize > this.maxFruitSize) {
            this.maxFruitSize = newSize;
          }

          // 드롭한 과일이 합쳐졌으면 새 과일로 교체
          if (this.droppedFruitId === fruitA.id || this.droppedFruitId === fruitB.id) {
            this.droppedFruitId = newFruitId;
          }

          // 서버에 점수 보고
          const room = this.sync.room;
          if (room) {
            const newPartyScore = room.partyScore + scoreGain;
            this.sync.reportScore(this.score, newPartyScore);
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
      // 과일의 상단이 게임오버 라인 위에 있고, 속도가 거의 없을 때만
      const speed = Math.sqrt(fruit.velocity.x ** 2 + fruit.velocity.y ** 2);
      if (fruit.position.y - radius < GAME_OVER_Y && speed < 2) {
        return true;
      }
    }
    return false;
  }

  // 게임오버 타이머 업데이트 (호스트만)
  private updateGameOverCheck(): void {
    if (!this.sync.isHost) return;

    const overLine = this.checkFruitsOverLine();

    if (overLine) {
      this.gameOverTimer++;
      this.isOverLine = true;

      // 2초 동안 계속 라인 위에 있으면 게임오버
      if (this.gameOverTimer >= GAME_OVER_CHECK_FRAMES) {
        console.log('[GameOver] 2초 동안 라인 위에 있어서 게임오버');
        this.sync.reportGameOver();
      }
    } else {
      // 라인 아래로 내려가면 타이머 리셋
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

  // 다음 과일 크기 결정 (중앙값 기준 확률 분포)
  private getNextFruitSize(): number {
    // 스폰 가능 최대 크기: maxFruitSize - 1 (최소 1, 최대 5)
    const maxSpawn = Math.min(Math.max(1, this.maxFruitSize - 1), 5);

    if (maxSpawn === 1) return 1;

    // 중앙값 계산: (maxSpawn + 1) / 2
    const center = (maxSpawn + 1) / 2;

    // 각 크기별 가중치 계산 (중앙에서 멀어질수록 낮아짐)
    const weights: number[] = [];
    for (let size = 1; size <= maxSpawn; size++) {
      const distance = Math.abs(size - center);
      // 가중치: 중앙일수록 높음 (거리에 따라 지수적으로 감소)
      const weight = Math.pow(0.6, distance);
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
    this.sync.syncAllFruits(fruitsData);
  }

  private showGameOverScreen(partyScore: number): void {
    const room = this.sync.room;
    if (!room) return;

    const players = Object.values(room.players) as RoomPlayer[];
    players.sort((a, b) => b.score - a.score);

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML = `
      <div class="game-over-content">
        <h1>Game Over!</h1>
        <h2>Party Score: ${partyScore}</h2>
        <div class="final-rankings">
          <h3>Rankings</h3>
          ${players
            .map((player, index) => {
              const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
              return `<div class="ranking-item">${medal} ${player.name}: ${player.score}</div>`;
            })
            .join('')}
        </div>
        <button class="btn btn-primary" onclick="location.reload()">Play Again</button>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .game-over-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .game-over-content {
        background: #1a1a2e;
        padding: 40px;
        border-radius: 16px;
        text-align: center;
        color: white;
      }
      .game-over-content h1 {
        color: #e94560;
        margin-bottom: 20px;
      }
      .final-rankings {
        margin: 20px 0;
      }
      .ranking-item {
        padding: 8px;
        margin: 4px 0;
        background: #2a2a3e;
        border-radius: 8px;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
  }

  private gameLoop = (): void => {
    if (!this.isRunning) return;

    this.frameCount++;

    // 호스트만 물리 엔진 업데이트
    if (this.sync.isHost) {
      Matter.Engine.update(this.engine, 1000 / 60);

      // 주기적으로 과일 위치 동기화
      if (this.frameCount % SYNC_INTERVAL === 0) {
        this.syncFruitsToServer();
      }

      // 게임오버 검사 (2초 동안 라인 위에 있으면 게임오버)
      this.updateGameOverCheck();
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

    // 드롭 가이드라인 (ready 상태일 때)
    if (this.turnPhase === 'ready') {
      ctx.strokeStyle = '#ffffff44';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(this.dropX, DROP_Y);
      ctx.lineTo(this.dropX, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);

      // 프리뷰 과일
      const data = FRUIT_DATA[this.currentFruitSize - 1];
      ctx.beginPath();
      ctx.arc(this.dropX, DROP_Y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.currentFruitSize.toString(), this.dropX, DROP_Y);
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
    for (const fruitState of Object.values(this.remoteFruits)) {
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

    // 점수
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Party: ${room?.partyScore || 0}`, 10, 10);
    ctx.fillText(`My: ${this.score}`, 10, 28);

    // 호스트 표시
    if (this.sync.isHost) {
      ctx.fillStyle = '#4BC0C0';
      ctx.fillText('(Host)', 10, 46);
    }

    // 현재 턴 플레이어
    if (room) {
      const currentPlayerId = room.playerOrder[room.currentPlayerIndex];
      const currentPlayer = room.players[currentPlayerId];
      const isMyTurn = this.sync.isMyTurn;

      ctx.textAlign = 'right';
      ctx.fillStyle = isMyTurn ? '#4BC0C0' : '#fff';
      ctx.fillText(isMyTurn ? 'Your Turn!' : `${currentPlayer?.name || 'Unknown'}'s Turn`, WIDTH - 10, 10);
    }

    // 타이머 (ready 상태일 때)
    if (this.turnPhase === 'ready' && this.sync.isMyTurn) {
      ctx.textAlign = 'center';
      ctx.fillStyle = this.timeRemaining <= 3 ? '#e94560' : 'rgba(233, 69, 96, 0.8)';
      ctx.beginPath();
      ctx.roundRect(WIDTH / 2 - 25, 8, 50, 28, 6);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px Arial';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this.timeRemaining}`, WIDTH / 2, 22);
    }

    // Waiting 표시 (settling)
    if (this.turnPhase === 'settling') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFCD56';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('Settling...', WIDTH / 2, 45);
    }

    // 게임오버 경고 표시
    if (this.isOverLine && this.gameOverTimer > 0) {
      const remainingTime = Math.ceil((GAME_OVER_CHECK_FRAMES - this.gameOverTimer) / 60);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e94560';
      ctx.font = 'bold 16px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText(`WARNING! ${remainingTime}s`, WIDTH / 2, 65);
    }

    // 플레이어 목록 (우측)
    if (room) {
      const players = Object.values(room.players) as RoomPlayer[];
      players.sort((a, b) => b.score - a.score);

      ctx.textAlign = 'right';
      ctx.font = '11px Arial';
      ctx.textBaseline = 'top';

      players.forEach((player, i) => {
        const isCurrentTurn = room.playerOrder[room.currentPlayerIndex] === player.id;
        const hostMark = player.isHost ? '★' : '';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        ctx.fillStyle = isCurrentTurn ? '#4BC0C0' : '#aaa';
        ctx.fillText(`${medal}${hostMark}${player.name}: ${player.score}`, WIDTH - 10, 50 + i * 16);
      });
    }
  }

  start(): void {
    this.isRunning = true;
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
    this.stopMoving();
  }
}
