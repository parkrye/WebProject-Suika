import { NetworkManager } from './NetworkManager';
import type { RoomState, FruitState } from './types';
import { GAME_CONFIG } from '../core/config';

export type GameSyncEvent =
  | { type: 'room_update'; room: RoomState }
  | { type: 'turn_start'; playerId: string; fruitSize: number; fruitX: number }
  | { type: 'fruit_move'; x: number }
  | { type: 'fruit_drop'; fruitId: string; x: number; y: number; size: number }
  | { type: 'fruit_merge'; removedIds: string[]; newFruit: FruitState }
  | { type: 'score_update'; playerId: string; score: number; partyScore: number }
  | { type: 'game_start' }
  | { type: 'game_over'; partyScore: number }
  | { type: 'player_join'; playerId: string; playerName: string }
  | { type: 'player_leave'; playerId: string };

type EventListener = (event: GameSyncEvent) => void;

export class GameSync {
  private network: NetworkManager;
  private listeners: EventListener[] = [];
  private currentRoom: RoomState | null = null;
  private lastRoomState: RoomState | null = null;
  private lastEmittedTurnStartTime = 0; // 중복 turn_start 방지

  constructor(network: NetworkManager) {
    this.network = network;
    this.network.onRoomUpdate(this.handleRoomUpdate.bind(this));
  }

  get playerId(): string {
    return this.network.id;
  }

  get isMyTurn(): boolean {
    if (!this.currentRoom) return false;
    const currentPlayerId = this.currentRoom.playerOrder[this.currentRoom.currentPlayerIndex];
    return currentPlayerId === this.network.id;
  }

  get currentTurnPlayerId(): string | null {
    if (!this.currentRoom) return null;
    return this.currentRoom.playerOrder[this.currentRoom.currentPlayerIndex];
  }

  get room(): RoomState | null {
    return this.currentRoom;
  }

  get turnTimeRemaining(): number {
    if (!this.currentRoom || this.currentRoom.status !== 'playing') return 0;
    const elapsed = (Date.now() - this.currentRoom.turnStartTime) / 1000;
    return Math.max(0, GAME_CONFIG.TURN_TIME - elapsed);
  }

  get isHost(): boolean {
    return this.network.isHost();
  }

  private handleRoomUpdate(room: RoomState): void {
    const prevRoom = this.lastRoomState;
    this.currentRoom = room;
    this.lastRoomState = { ...room };

    this.emit({ type: 'room_update', room });

    // 첫 번째 업데이트이고 이미 playing 상태면 바로 game_start
    if (!prevRoom) {
      if (room.status === 'playing') {
        this.lastEmittedTurnStartTime = room.turnStartTime; // 중복 방지 초기화
        this.emit({ type: 'game_start' });
      }
      return;
    }

    // 게임 시작 감지
    if (prevRoom.status === 'waiting' && room.status === 'playing') {
      this.lastEmittedTurnStartTime = room.turnStartTime; // 중복 방지 초기화
      this.emit({ type: 'game_start' });
    }

    // 게임 종료 감지
    if (prevRoom.status === 'playing' && room.status === 'ended') {
      this.emit({ type: 'game_over', partyScore: room.partyScore });
    }

    // 턴 변경 감지 (중복 방지)
    if (room.status === 'playing' && room.currentFruit) {
      if (room.turnStartTime === this.lastEmittedTurnStartTime) {
        // 중복이면 무시
      } else {
        console.log('[GameSync] turn_start emit - turnStartTime:', room.turnStartTime, 'last:', this.lastEmittedTurnStartTime);
        this.lastEmittedTurnStartTime = room.turnStartTime;
        const currentPlayerId = room.playerOrder[room.currentPlayerIndex];
        this.emit({
          type: 'turn_start',
          playerId: currentPlayerId,
          fruitSize: room.currentFruit.size,
          fruitX: room.currentFruit.x,
        });
      }
    }

    // 현재 과일 위치 변경 감지
    if (
      room.currentFruit &&
      prevRoom.currentFruit &&
      prevRoom.currentFruit.x !== room.currentFruit.x
    ) {
      this.emit({ type: 'fruit_move', x: room.currentFruit.x });
    }

    // 플레이어 참가/퇴장 감지
    const prevPlayerIds = Object.keys(prevRoom.players);
    const currentPlayerIds = Object.keys(room.players);

    for (const playerId of currentPlayerIds) {
      if (!prevPlayerIds.includes(playerId)) {
        this.emit({
          type: 'player_join',
          playerId,
          playerName: room.players[playerId].name,
        });
      }
    }

    for (const playerId of prevPlayerIds) {
      if (!currentPlayerIds.includes(playerId)) {
        this.emit({ type: 'player_leave', playerId });
      }
    }

    // 점수 변경 감지
    for (const playerId of currentPlayerIds) {
      const prevPlayer = prevRoom.players[playerId];
      const currentPlayer = room.players[playerId];
      if (prevPlayer && currentPlayer && prevPlayer.score !== currentPlayer.score) {
        this.emit({
          type: 'score_update',
          playerId,
          score: currentPlayer.score,
          partyScore: room.partyScore,
        });
      }
    }
  }

  on(listener: EventListener): void {
    this.listeners.push(listener);
  }

  off(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emit(event: GameSyncEvent): void {
    console.log('[GameSync] emit:', event.type, 'listeners count:', this.listeners.length);
    this.listeners.forEach((listener) => listener(event));
  }

  async moveFruit(x: number): Promise<void> {
    if (!this.isMyTurn) return;
    await this.network.updateCurrentFruitPosition(x);
  }

  async dropFruit(fruitId: string, x: number, y: number, size: number): Promise<void> {
    if (!this.isMyTurn) return;
    await this.network.dropFruit(fruitId, x, y, size);
  }

  async reportMerge(
    removedId1: string,
    removedId2: string,
    newFruitId: string,
    x: number,
    y: number,
    newSize: number
  ): Promise<void> {
    await this.network.removeFruit(removedId1);
    await this.network.removeFruit(removedId2);
    await this.network.addMergedFruit(newFruitId, x, y, newSize);

    if (newSize > (this.currentRoom?.maxFruitSize || 1)) {
      await this.network.updateMaxFruitSize(newSize);
    }
  }

  async reportScore(score: number, partyScore: number): Promise<void> {
    await this.network.updateScore(this.network.id, score, partyScore);
  }

  async nextTurn(nextFruitSize: number): Promise<void> {
    await this.network.nextTurn(nextFruitSize);
  }

  async reportGameOver(): Promise<void> {
    await this.network.endGame();
  }

  async syncAllFruits(fruits: Record<string, { x: number; y: number; size: number }>): Promise<void> {
    await this.network.syncAllFruits(fruits);
  }
}
