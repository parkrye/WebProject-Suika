import Matter from 'matter-js';
import { GameSync, type GameSyncEvent } from '../network/GameSync';
import type { RoomPlayer } from '../network/types';

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

type TurnPhase = 'waiting' | 'ready' | 'dropping' | 'settling';

export class MultiplayerGame {
  private ctx: CanvasRenderingContext2D;
  private sync: GameSync;

  // Matter.js
  private engine: Matter.Engine;
  private fruits = new Map<number, Matter.Body>();
  private nextFruitId = 0;

  // 게임 상태
  private score = 0;
  private maxFruitSize = 1;
  private isRunning = false;

  // 턴 상태
  private turnPhase: TurnPhase = 'waiting';
  private dropX = WIDTH / 2;
  private currentFruitSize = 1;
  private droppedFruit: Matter.Body | null = null;

  // 타이머
  private timeRemaining = TURN_TIME;
  private timerInterval: number | null = null;

  // 이동
  private moveInterval: number | null = null;
  private readonly MOVE_SPEED = 3;

  // 충돌 처리
  private mergedPairs = new Set<string>();
  private settleCheckTimer = 0;

  constructor(canvas: HTMLCanvasElement, sync: GameSync) {
    this.ctx = canvas.getContext('2d')!;
    this.sync = sync;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    // Matter.js 엔진 생성
    this.engine = Matter.Engine.create();
    this.engine.world.gravity.y = 1;

    // 벽 생성
    const walls = [
      Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + 10, WIDTH + 40, 20, { isStatic: true, label: 'floor' }),
      Matter.Bodies.rectangle(-10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(WIDTH + 10, HEIGHT / 2, 20, HEIGHT * 2, { isStatic: true, label: 'wall' }),
    ];
    Matter.Composite.add(this.engine.world, walls);

    // 충돌 이벤트
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

  private handleTurnStart(_playerId: string, fruitSize: number, fruitX: number): void {
    this.stopTimer();
    this.turnPhase = 'ready';
    this.currentFruitSize = fruitSize;
    this.dropX = fruitX;
    this.droppedFruit = null;

    // 내 턴이면 타이머 시작
    if (this.sync.isMyTurn) {
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
    if (!this.sync.isMyTurn || this.turnPhase !== 'ready') return;

    this.stopTimer();
    this.turnPhase = 'dropping';

    // 과일 생성
    this.droppedFruit = this.createFruit(this.dropX, DROP_Y, this.currentFruitSize);
    this.turnPhase = 'settling';

    // 서버에 드롭 알림
    const fruitId = `fruit_${this.nextFruitId - 1}`;
    this.sync.dropFruit(fruitId, this.dropX, DROP_Y, this.currentFruitSize);
  }

  private createFruit(x: number, y: number, size: number): Matter.Body {
    const data = FRUIT_SIZES[size - 1] || FRUIT_SIZES[0];
    const id = this.nextFruitId++;

    const fruit = Matter.Bodies.circle(x, y, data.radius, {
      restitution: 0.2,
      friction: 0.5,
      label: `fruit_${id}_${size}`,
    });

    Matter.Composite.add(this.engine.world, fruit);
    this.fruits.set(id, fruit);
    return fruit;
  }

  private removeFruit(id: number): void {
    const fruit = this.fruits.get(id);
    if (fruit) {
      Matter.Composite.remove(this.engine.world, fruit);
      this.fruits.delete(id);
    }
  }

  private parseFruitLabel(label: string): { id: number; size: number } | null {
    const match = label.match(/^fruit_(\d+)_(\d+)$/);
    if (match) {
      return { id: parseInt(match[1]), size: parseInt(match[2]) };
    }
    return null;
  }

  private handleCollision(event: Matter.IEventCollision<Matter.Engine>): void {
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

        if (!bodyA || !bodyB) return;

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;
        const newSize = Math.min(fruitA.size + 1, FRUIT_SIZES.length);

        this.removeFruit(fruitA.id);
        this.removeFruit(fruitB.id);

        const newFruit = this.createFruit(midX, midY, newSize);

        // 점수 추가
        const scoreGain = FRUIT_SIZES[newSize - 1]?.score || 0;
        this.score += scoreGain;

        // 최대 크기 업데이트
        if (newSize > this.maxFruitSize) {
          this.maxFruitSize = newSize;
        }

        // 드롭한 과일이 합쳐졌으면 새 과일로 교체
        if (this.droppedFruit === bodyA || this.droppedFruit === bodyB) {
          this.droppedFruit = newFruit;
        }

        // 서버에 점수 보고 (내 턴일 때만)
        if (this.sync.isMyTurn) {
          const room = this.sync.room;
          if (room) {
            const newPartyScore = room.partyScore + scoreGain;
            this.sync.reportScore(this.score, newPartyScore);
          }
        }

        this.mergedPairs.delete(pairKey);
      }, 0);
    }
  }

  private checkSettled(): boolean {
    if (!this.droppedFruit) return true;
    const speed = Matter.Vector.magnitude(this.droppedFruit.velocity);
    const angularSpeed = Math.abs(this.droppedFruit.angularVelocity);
    return speed < 0.3 && angularSpeed < 0.03;
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
    // 게임오버 체크
    if (this.checkGameOver()) {
      await this.sync.reportGameOver();
      return;
    }

    // 다음 과일 크기 결정
    const maxSpawn = Math.min(Math.max(1, this.maxFruitSize - 1), 5);
    const nextSize = Math.floor(Math.random() * maxSpawn) + 1;

    // 서버에 다음 턴 요청
    await this.sync.nextTurn(nextSize);
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

    document.body.appendChild(overlay);
  }

  private gameLoop = (): void => {
    if (!this.isRunning) return;

    // 물리 업데이트
    Matter.Engine.update(this.engine, 1000 / 60);

    // settling 상태에서 안정화 체크 (내 턴일 때만)
    if (this.turnPhase === 'settling' && this.sync.isMyTurn) {
      this.settleCheckTimer++;
      if (this.settleCheckTimer > 30 && this.checkSettled()) {
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

    // 과일 그리기
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

    // UI
    this.renderUI();
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

    // Waiting 표시
    if (this.turnPhase === 'settling') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFCD56';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('Waiting...', WIDTH / 2, 45);
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
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        ctx.fillStyle = isCurrentTurn ? '#4BC0C0' : '#aaa';
        ctx.fillText(`${medal}${player.name}: ${player.score}`, WIDTH - 10, 50 + i * 16);
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
