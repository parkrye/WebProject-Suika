import Matter from 'matter-js';
import { GameSync, type GameSyncEvent } from '../network/GameSync';
import type { RoomPlayer, FruitState, RoomState } from '../network/types';

// 과일 크기별 데이터
const FRUIT_SIZES = [
  { size: 1, radius: 15, color: '#FF6B6B', score: 0 },
  { size: 2, radius: 22, color: '#FF8E53', score: 10 },
  { size: 3, radius: 30, color: '#FFCD56', score: 30 },
  { size: 4, radius: 40, color: '#4BC0C0', score: 80 },
  { size: 5, radius: 52, color: '#36A2EB', score: 150 },
  { size: 6, radius: 65, color: '#9966FF', score: 250 },
  { size: 7, radius: 80, color: '#FF6384', score: 400 },
];

const WIDTH = 400;
const HEIGHT = 600;
const DROP_Y = 80;
const GAME_OVER_Y = 100;
const TURN_TIME = 10;
const SYNC_INTERVAL = 5; // 호스트가 몇 프레임마다 동기화할지

type TurnPhase = 'waiting' | 'ready' | 'dropping' | 'settling';

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
    for (const [id, fruitState] of Object.entries(this.remoteFruits)) {
      if (!this.fruits.has(id)) {
        // 새 과일 생성 (비호스트가 드롭한 것)
        console.log('[Host] 비호스트 과일 추가:', id);
        this.createFruitWithId(id, fruitState.x, fruitState.y, fruitState.size);
      }
      // 기존 과일 위치는 업데이트하지 않음 (호스트가 물리 시뮬레이션 권위자)
    }
  }

  private syncFruitsFromRemote(): void {
    const remoteIds = new Set(Object.keys(this.remoteFruits));

    // 원격에 없는 로컬 과일 제거 (단, 방금 드롭한 과일은 보호)
    for (const [id, body] of this.fruits) {
      if (!remoteIds.has(id)) {
        // 내가 방금 드롭한 과일은 Firebase 동기화 완료까지 보호
        if (id === this.droppedFruitId) {
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
    const radius = FRUIT_SIZES[this.currentFruitSize - 1].radius;
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
    const data = FRUIT_SIZES[size - 1] || FRUIT_SIZES[0];

    const fruit = Matter.Bodies.circle(x, y, data.radius, {
      restitution: 0.2,
      friction: 0.5,
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
        const newSize = Math.min(fruitA.size + 1, FRUIT_SIZES.length);

        // 기존 과일 제거
        this.removeFruitById(fruitA.id);
        this.removeFruitById(fruitB.id);

        // 새 과일 생성
        const newFruitId = `fruit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.createFruitWithId(newFruitId, midX, midY, newSize);

        // 점수 추가
        const scoreGain = FRUIT_SIZES[newSize - 1]?.score || 0;
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

        this.mergedPairs.delete(pairKey);

        // 즉시 동기화
        this.syncFruitsToServer();
      }, 0);
    }
  }

  private checkGameOver(): boolean {
    for (const [, fruit] of this.fruits) {
      const parsed = this.parseFruitLabel(fruit.label);
      if (!parsed) continue;
      const radius = FRUIT_SIZES[parsed.size - 1]?.radius || 15;
      if (fruit.position.y - radius < GAME_OVER_Y) {
        return true;
      }
    }
    return false;
  }

  private async nextTurn(): Promise<void> {
    console.log('[NextTurn] 호출됨 - isHost:', this.sync.isHost, 'isMyTurn:', this.sync.isMyTurn);

    // 게임오버 체크 (호스트만)
    if (this.sync.isHost && this.checkGameOver()) {
      console.log('[NextTurn] 게임오버!');
      await this.sync.reportGameOver();
      return;
    }

    // 다음 과일 크기 결정
    const maxSpawn = Math.min(Math.max(1, this.maxFruitSize - 1), 5);
    const nextSize = Math.floor(Math.random() * maxSpawn) + 1;

    console.log('[NextTurn] 다음 과일 크기:', nextSize, '서버 요청 중...');

    // 서버에 다음 턴 요청 (현재 턴 플레이어만)
    if (this.sync.isMyTurn) {
      await this.sync.nextTurn(nextSize);
      console.log('[NextTurn] 서버 요청 완료');
    }
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
    }

    // settling 상태에서 안정화 체크 (내 턴일 때)
    if (this.turnPhase === 'settling' && this.sync.isMyTurn) {
      this.settleCheckTimer++;
      // 임시: 3초(180프레임) 후 다음 턴으로
      if (this.settleCheckTimer > 180) {
        console.log('[Settle] 3초 경과, 다음 턴으로');
        this.settleCheckTimer = 0;
        this.turnPhase = 'waiting';
        this.nextTurn();
      }
    }

    // 렌더링
    this.render();

    requestAnimationFrame(this.gameLoop);
  };

  private render(): void {
    const ctx = this.ctx;

    // 배경
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 벽
    ctx.fillStyle = '#333';
    ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
    ctx.fillRect(0, 0, 4, HEIGHT);
    ctx.fillRect(WIDTH - 4, 0, 4, HEIGHT);

    // 게임오버 라인
    ctx.strokeStyle = '#e94560';
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(0, GAME_OVER_Y);
    ctx.lineTo(WIDTH, GAME_OVER_Y);
    ctx.stroke();
    ctx.setLineDash([]);

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
      const data = FRUIT_SIZES[this.currentFruitSize - 1];
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

      const data = FRUIT_SIZES[parsed.size - 1] || FRUIT_SIZES[0];

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
    // 원격 과일 렌더링
    for (const fruitState of Object.values(this.remoteFruits)) {
      const data = FRUIT_SIZES[fruitState.size - 1] || FRUIT_SIZES[0];

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

    // 방금 드롭한 과일이 원격에 아직 없으면 로컬에서 렌더링
    if (this.droppedFruitId && !this.remoteFruits[this.droppedFruitId]) {
      const droppedFruit = this.fruits.get(this.droppedFruitId);
      if (droppedFruit) {
        const { x, y } = droppedFruit.position;
        const parsed = this.parseFruitLabel(droppedFruit.label);
        if (parsed) {
          const data = FRUIT_SIZES[parsed.size - 1] || FRUIT_SIZES[0];

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

    // Waiting 표시 (settling 카운트다운)
    if (this.turnPhase === 'settling') {
      const remainingFrames = 180 - this.settleCheckTimer;
      const remainingSeconds = Math.ceil(remainingFrames / 60);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFCD56';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText(`Settling... ${remainingSeconds}s`, WIDTH / 2, 45);
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
