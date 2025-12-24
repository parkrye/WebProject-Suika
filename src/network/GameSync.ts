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
  | { type: 'player_leave'; playerId: string }
  | { type: 'drop_request'; playerId: string; x: number; size: number; velocityX: number; velocityY: number };

type EventListener = (event: GameSyncEvent) => void;

export class GameSync {
  private network: NetworkManager;
  private listeners: EventListener[] = [];
  private currentRoom: RoomState | null = null;
  private lastRoomState: RoomState | null = null;
  private lastEmittedTurnStartTime = 0; // 중복 turn_start 방지
  private lastProcessedDropRequestId: string | null = null; // 중복 drop_request 방지

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

  get hasNoHost(): boolean {
    return this.network.hasNoHost();
  }

  get shouldBecomeHost(): boolean {
    return this.network.shouldBecomeHost();
  }

  async promoteToHost(): Promise<void> {
    await this.network.promoteToHost();
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

    // 드롭 요청 감지 (호스트만 처리)
    if (this.isHost && room.dropRequest) {
      if (room.dropRequest.id !== this.lastProcessedDropRequestId) {
        this.lastProcessedDropRequestId = room.dropRequest.id;
        this.emit({
          type: 'drop_request',
          playerId: room.dropRequest.playerId,
          x: room.dropRequest.x,
          size: room.dropRequest.size,
          velocityX: room.dropRequest.velocityX,
          velocityY: room.dropRequest.velocityY,
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

  // 비호스트용: 드롭 요청만 전송
  async requestDrop(x: number, size: number): Promise<void> {
    if (!this.isMyTurn) return;
    await this.network.requestDrop(x, size);
  }

  // 비호스트용: 속도 포함 드롭 요청 전송 (슬링샷)
  async requestDropWithVelocity(
    x: number,
    size: number,
    velocity: { x: number; y: number }
  ): Promise<void> {
    if (!this.isMyTurn) return;
    await this.network.requestDropWithVelocity(x, size, velocity);
  }

  // 호스트용: 속도 포함 과일 드롭 (슬링샷)
  async dropFruitWithVelocity(
    fruitId: string,
    x: number,
    y: number,
    size: number,
    velocity: { x: number; y: number }
  ): Promise<void> {
    if (!this.isMyTurn) return;
    await this.network.dropFruitWithVelocity(fruitId, x, y, size, velocity);
  }

  // 호스트용: 비호스트의 속도 포함 드롭 요청 처리
  async hostAddFruitWithVelocity(
    fruitId: string,
    x: number,
    y: number,
    size: number,
    velocity: { x: number; y: number }
  ): Promise<void> {
    if (!this.isHost) return;
    await this.network.dropFruitWithVelocity(fruitId, x, y, size, velocity);
  }

  // 호스트용: 드롭 요청 처리 완료 후 삭제
  async clearDropRequest(): Promise<void> {
    await this.network.clearDropRequest();
  }

  // 호스트 전용: 비호스트의 드롭 요청 처리 시 과일 추가 (isMyTurn 체크 없음)
  async hostAddFruit(fruitId: string, x: number, y: number, size: number): Promise<void> {
    if (!this.isHost) return;
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

  // 호스트 전용: 특정 플레이어의 점수 업데이트 (합성 점수용)
  async reportPlayerScore(playerId: string, scoreGain: number, partyScore: number): Promise<void> {
    if (!this.isHost) return;
    const room = this.currentRoom;
    if (!room) return;

    const player = room.players[playerId];
    if (!player) return;

    const newScore = player.score + scoreGain;
    await this.network.updateScore(playerId, newScore, partyScore);
  }

  async nextTurn(nextFruitSize: number): Promise<void> {
    await this.network.nextTurn(nextFruitSize);
  }

  async reportGameOver(): Promise<void> {
    await this.network.endGame();
  }

  async syncAllFruits(
    fruits: Record<string, { x: number; y: number; size: number }>,
    deletedIds: string[] = []
  ): Promise<void> {
    await this.network.syncAllFruits(fruits, deletedIds);
  }

  async cleanupDisconnectedPlayers(): Promise<void> {
    await this.network.cleanupDisconnectedPlayers();
  }
}
