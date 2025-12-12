import Matter from 'matter-js';
import { Physics } from '../core/Physics';
import { GAME_CONFIG, getFruitData, getScoreForMerge } from '../core/config';
import type { GameConfig, GameState, TurnState } from '../core/types';
import { Fruit } from './Fruit';
import { Renderer } from './Renderer';

export class Game {
  private physics: Physics;
  private renderer: Renderer;
  private config: GameConfig;

  private fruits: Map<number, Fruit> = new Map();
  private currentFruit: Fruit | null = null;
  private nextFruitId = 0;

  private gameState: GameState = {
    players: [{ id: '1', name: 'Player 1', score: 0 }],
    currentPlayerIndex: 0,
    partyScore: 0,
    maxFruitSize: 1,
    isGameOver: false,
  };

  private turnState: TurnState = {
    timeRemaining: GAME_CONFIG.TURN_TIME,
    currentFruitSize: 1,
    dropX: 200,
  };

  private turnTimer: number | null = null;
  private isRunning = false;

  constructor(canvas: HTMLCanvasElement, config: GameConfig) {
    this.config = config;
    this.physics = new Physics();
    this.renderer = new Renderer(canvas, config.width, config.height);

    this.physics.createWalls(config.width, config.height);
    this.setupCollisionHandling();
    this.setupInput(canvas);
  }

  private setupCollisionHandling(): void {
    this.physics.onCollision((pairs) => {
      for (const pair of pairs) {
        this.handleCollision(pair.bodyA, pair.bodyB);
      }
    });
  }

  private handleCollision(bodyA: Matter.Body, bodyB: Matter.Body): void {
    const fruitA = this.findFruitByBody(bodyA);
    const fruitB = this.findFruitByBody(bodyB);

    if (!fruitA || !fruitB) return;
    if (!fruitA.isDropped || !fruitB.isDropped) return;
    if (fruitA.size !== fruitB.size) return;

    this.mergeFruits(fruitA, fruitB);
  }

  private findFruitByBody(body: Matter.Body): Fruit | undefined {
    for (const fruit of this.fruits.values()) {
      if (fruit.body === body) return fruit;
    }
    return undefined;
  }

  private mergeFruits(fruitA: Fruit, fruitB: Fruit): void {
    const newSize = fruitA.size + 1;
    const midX = (fruitA.x + fruitB.x) / 2;
    const midY = (fruitA.y + fruitB.y) / 2;

    this.removeFruit(fruitA);
    this.removeFruit(fruitB);

    const newFruit = this.createFruit(midX, midY, newSize);
    newFruit.isDropped = true;

    const score = getScoreForMerge(newSize);
    this.addScore(score);

    if (newSize > this.gameState.maxFruitSize) {
      this.gameState.maxFruitSize = newSize;
    }
  }

  private createFruit(x: number, y: number, size: number): Fruit {
    const fruitData = getFruitData(size);
    const body = this.physics.createCircle(x, y, fruitData.radius, {
      label: `fruit_${size}`,
    });
    const fruit = new Fruit(body, size);
    this.fruits.set(this.nextFruitId++, fruit);
    return fruit;
  }

  private removeFruit(fruit: Fruit): void {
    this.physics.removeBody(fruit.body);
    for (const [id, f] of this.fruits) {
      if (f === fruit) {
        this.fruits.delete(id);
        break;
      }
    }
  }

  private addScore(score: number): void {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    currentPlayer.score += score;
    this.gameState.partyScore += score;
    this.updateScoreDisplay();
  }

  private updateScoreDisplay(): void {
    const partyScoreEl = document.getElementById('party-score');
    const myScoreEl = document.getElementById('my-score');
    if (partyScoreEl) partyScoreEl.textContent = this.gameState.partyScore.toString();
    if (myScoreEl) {
      const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
      myScoreEl.textContent = currentPlayer.score.toString();
    }
  }

  private setupInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousemove', (e) => {
      if (!this.currentFruit || this.gameState.isGameOver) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const radius = this.currentFruit.radius;
      this.turnState.dropX = Math.max(radius + 4, Math.min(this.config.width - radius - 4, x));
      this.currentFruit.setPosition(this.turnState.dropX, GAME_CONFIG.DROP_AREA_Y);
    });

    canvas.addEventListener('click', () => {
      if (!this.currentFruit || this.gameState.isGameOver) return;
      this.dropCurrentFruit();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.currentFruit || this.gameState.isGameOver) return;
      const moveSpeed = 10;
      const radius = this.currentFruit.radius;

      if (e.key === 'ArrowLeft') {
        this.turnState.dropX = Math.max(radius + 4, this.turnState.dropX - moveSpeed);
      } else if (e.key === 'ArrowRight') {
        this.turnState.dropX = Math.min(this.config.width - radius - 4, this.turnState.dropX + moveSpeed);
      } else if (e.key === ' ' || e.key === 'Enter') {
        this.dropCurrentFruit();
      }
      this.currentFruit.setPosition(this.turnState.dropX, GAME_CONFIG.DROP_AREA_Y);
    });
  }

  private dropCurrentFruit(): void {
    if (!this.currentFruit) return;

    this.currentFruit.drop();
    this.currentFruit = null;

    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }

    setTimeout(() => {
      this.checkGameOver();
      if (!this.gameState.isGameOver) {
        this.startTurn();
      }
    }, 500);
  }

  private checkGameOver(): void {
    for (const fruit of this.fruits.values()) {
      if (fruit.isDropped && fruit.y - fruit.radius < GAME_CONFIG.GAME_OVER_LINE_Y) {
        this.gameState.isGameOver = true;
        this.endGame();
        return;
      }
    }
  }

  private endGame(): void {
    this.isRunning = false;
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
    }
    alert(`Game Over! Party Score: ${this.gameState.partyScore}`);
  }

  private getRandomFruitSize(): number {
    const maxSpawnSize = Math.max(1, this.gameState.maxFruitSize - 1);
    const clampedMax = Math.min(maxSpawnSize, 5);
    return Math.floor(Math.random() * clampedMax) + 1;
  }

  private startTurn(): void {
    this.turnState.timeRemaining = GAME_CONFIG.TURN_TIME;
    this.turnState.currentFruitSize = this.getRandomFruitSize();
    this.turnState.dropX = this.config.width / 2;

    const fruit = this.createFruit(
      this.turnState.dropX,
      GAME_CONFIG.DROP_AREA_Y,
      this.turnState.currentFruitSize
    );
    fruit.setStatic(true);
    this.currentFruit = fruit;

    this.turnTimer = window.setInterval(() => {
      this.turnState.timeRemaining--;
      this.updateTimerDisplay();

      if (this.turnState.timeRemaining <= 0) {
        this.dropCurrentFruit();
      }
    }, 1000);
  }

  private updateTimerDisplay(): void {
    const timerEl = document.getElementById('turn-timer');
    if (timerEl) {
      timerEl.textContent = this.turnState.timeRemaining.toString();
    }
  }

  private gameLoop = (): void => {
    if (!this.isRunning) return;

    this.physics.update();
    this.renderer.render(
      Array.from(this.fruits.values()),
      this.turnState.dropX,
      this.currentFruit
    );

    requestAnimationFrame(this.gameLoop);
  };

  start(): void {
    this.isRunning = true;
    this.startTurn();
    this.gameLoop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
    }
  }
}
