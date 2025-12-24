import {
  ref,
  set,
  get,
  push,
  onValue,
  onDisconnect,
  remove,
  update,
  off,
  DatabaseReference,
} from 'firebase/database';
import { database } from './firebase';
import type { RoomState, RoomPlayer, RoomEventCallback } from './types';

export class NetworkManager {
  private roomRef: DatabaseReference | null = null;
  private playerId: string;
  private playerName: string;
  private currentRoomId: string | null = null;
  private roomListeners: RoomEventCallback[] = [];

  constructor(playerName: string) {
    this.playerId = this.generatePlayerId();
    this.playerName = playerName;
  }

  private generatePlayerId(): string {
    return `player_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  get id(): string {
    return this.playerId;
  }

  get name(): string {
    return this.playerName;
  }

  get roomId(): string | null {
    return this.currentRoomId;
  }

  async createRoom(): Promise<string> {
    const roomsRef = ref(database, 'rooms');
    const newRoomRef = push(roomsRef);
    const roomId = newRoomRef.key!;

    const initialState: RoomState = {
      id: roomId,
      status: 'waiting',
      players: {
        [this.playerId]: {
          id: this.playerId,
          name: this.playerName,
          score: 0,
          isReady: false,
          isHost: true,
        },
      },
      playerOrder: [this.playerId],
      currentPlayerIndex: 0,
      turnStartTime: 0,
      partyScore: 0,
      maxFruitSize: 1,
      fruits: {},
      currentFruit: null,
      createdAt: Date.now(),
    };

    await set(newRoomRef, initialState);
    this.currentRoomId = roomId;
    this.roomRef = newRoomRef;

    this.setupDisconnectHandler();
    this.subscribeToRoom();

    return roomId;
  }

  async joinRoom(roomId: string): Promise<boolean> {
    const roomRef = ref(database, `rooms/${roomId}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
      throw new Error('Room not found');
    }

    const roomState = snapshot.val() as RoomState;

    if (roomState.status !== 'waiting') {
      throw new Error('Game already started');
    }

    const playerCount = Object.keys(roomState.players).length;
    if (playerCount >= 10) {
      throw new Error('Room is full');
    }

    const newPlayer: RoomPlayer = {
      id: this.playerId,
      name: this.playerName,
      score: 0,
      isReady: false,
      isHost: false,
    };

    await update(ref(database, `rooms/${roomId}/players/${this.playerId}`), newPlayer);
    await update(ref(database, `rooms/${roomId}`), {
      playerOrder: [...roomState.playerOrder, this.playerId],
    });

    this.currentRoomId = roomId;
    this.roomRef = roomRef;

    this.setupDisconnectHandler();
    this.subscribeToRoom();

    return true;
  }

  private setupDisconnectHandler(): void {
    if (!this.currentRoomId) return;

    const playerRef = ref(database, `rooms/${this.currentRoomId}/players/${this.playerId}`);
    onDisconnect(playerRef).remove();
  }

  private currentRoomState: RoomState | null = null;

  private subscribeToRoom(): void {
    if (!this.roomRef) return;

    onValue(this.roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const roomState = snapshot.val() as RoomState;
        this.currentRoomState = roomState;
        this.roomListeners.forEach((callback) => callback(roomState));
      }
    });
  }

  onRoomUpdate(callback: RoomEventCallback): void {
    this.roomListeners.push(callback);
    // 새 리스너 등록 시 현재 상태가 있으면 즉시 전달
    if (this.currentRoomState) {
      callback(this.currentRoomState);
    }
  }

  offRoomUpdate(callback: RoomEventCallback): void {
    this.roomListeners = this.roomListeners.filter((cb) => cb !== callback);
  }

  async setReady(isReady: boolean): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/players/${this.playerId}`), {
      isReady,
    });
  }

  async startGame(): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      status: 'playing',
      turnStartTime: Date.now(),
      currentFruit: {
        size: 1,
        x: 200,
      },
    });
  }

  async updateCurrentFruitPosition(x: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/currentFruit`), { x });
  }

  async dropFruit(fruitId: string, x: number, y: number, size: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/fruits/${fruitId}`), {
      id: fruitId,
      x,
      y,
      size,
      isDropped: true,
    });

    await set(ref(database, `rooms/${this.currentRoomId}/currentFruit`), null);
  }

  // 비호스트용: 드롭 요청만 전송 (호스트가 실제 drop 수행)
  async requestDrop(x: number, size: number): Promise<void> {
    if (!this.currentRoomId) return;

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await set(ref(database, `rooms/${this.currentRoomId}/dropRequest`), {
      id: requestId,
      playerId: this.playerId,
      x,
      size,
      velocityX: 0,
      velocityY: 0,
      timestamp: Date.now(),
    });

    await set(ref(database, `rooms/${this.currentRoomId}/currentFruit`), null);
  }

  // 비호스트용: 속도 포함 드롭 요청 전송 (슬링샷)
  async requestDropWithVelocity(
    x: number,
    size: number,
    velocity: { x: number; y: number }
  ): Promise<void> {
    if (!this.currentRoomId) return;

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await set(ref(database, `rooms/${this.currentRoomId}/dropRequest`), {
      id: requestId,
      playerId: this.playerId,
      x,
      size,
      velocityX: velocity.x,
      velocityY: velocity.y,
      timestamp: Date.now(),
    });

    await set(ref(database, `rooms/${this.currentRoomId}/currentFruit`), null);
  }

  // 호스트용: 속도 포함 과일 드롭 (슬링샷)
  async dropFruitWithVelocity(
    fruitId: string,
    x: number,
    y: number,
    size: number,
    velocity: { x: number; y: number }
  ): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/fruits/${fruitId}`), {
      id: fruitId,
      x,
      y,
      size,
      velocityX: velocity.x,
      velocityY: velocity.y,
      isDropped: true,
    });

    await set(ref(database, `rooms/${this.currentRoomId}/currentFruit`), null);
  }

  // 호스트용: 드롭 요청 처리 완료 후 삭제
  async clearDropRequest(): Promise<void> {
    if (!this.currentRoomId) return;
    await remove(ref(database, `rooms/${this.currentRoomId}/dropRequest`));
  }

  async nextTurn(nextFruitSize: number): Promise<void> {
    if (!this.currentRoomId || !this.currentRoomState) return;

    // 현재 상태에서 다음 인덱스 계산
    const playerOrderLength = this.currentRoomState.playerOrder?.length || 1;
    const nextIndex = (this.currentRoomState.currentPlayerIndex + 1) % playerOrderLength;

    // 일반 update 사용 (트랜잭션 충돌 방지)
    await update(ref(database, `rooms/${this.currentRoomId}`), {
      currentPlayerIndex: nextIndex,
      turnStartTime: Date.now(),
      currentFruit: {
        size: nextFruitSize,
        x: 200,
      },
    });
  }

  async updateFruitPosition(fruitId: string, x: number, y: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/fruits/${fruitId}`), { x, y });
  }

  async removeFruit(fruitId: string): Promise<void> {
    if (!this.currentRoomId) return;

    await remove(ref(database, `rooms/${this.currentRoomId}/fruits/${fruitId}`));
  }

  async addMergedFruit(fruitId: string, x: number, y: number, size: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}/fruits/${fruitId}`), {
      id: fruitId,
      x,
      y,
      size,
      isDropped: true,
    });
  }

  async updateScore(playerId: string, score: number, partyScore: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      partyScore,
      [`players/${playerId}/score`]: score,
    });
  }

  async updateMaxFruitSize(maxSize: number): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      maxFruitSize: maxSize,
    });
  }

  async syncAllFruits(
    fruits: Record<string, { x: number; y: number; size: number }>,
    deletedIds: string[] = []
  ): Promise<void> {
    if (!this.currentRoomId) return;

    const fruitsUpdate: Record<string, { id: string; x: number; y: number; size: number; isDropped: boolean } | null> = {};

    // 업데이트할 과일
    for (const [id, fruit] of Object.entries(fruits)) {
      fruitsUpdate[id] = {
        id,
        x: fruit.x,
        y: fruit.y,
        size: fruit.size,
        isDropped: true,
      };
    }

    // 삭제할 과일 (null로 설정하면 Firebase에서 삭제됨)
    for (const id of deletedIds) {
      fruitsUpdate[id] = null;
    }

    // update()는 기존 데이터를 유지하면서 지정된 항목만 업데이트
    await update(ref(database, `rooms/${this.currentRoomId}/fruits`), fruitsUpdate);
  }

  isHost(): boolean {
    if (!this.currentRoomState) return false;
    const players = Object.values(this.currentRoomState.players);
    const host = players.find(p => p.isHost);
    return host?.id === this.playerId;
  }

  // 호스트가 없는지 확인 (연결 해제됨)
  hasNoHost(): boolean {
    if (!this.currentRoomState) return false;
    const players = Object.values(this.currentRoomState.players);
    return !players.some(p => p.isHost);
  }

  // 자신이 새 호스트가 되어야 하는지 확인 (playerOrder 첫 번째)
  shouldBecomeHost(): boolean {
    if (!this.currentRoomState) return false;
    if (!this.hasNoHost()) return false;

    // playerOrder에서 실제로 존재하는 첫 번째 플레이어가 새 호스트
    const activePlayers = Object.keys(this.currentRoomState.players);
    const firstActivePlayer = this.currentRoomState.playerOrder.find(
      (id: string) => activePlayers.includes(id)
    );
    return firstActivePlayer === this.playerId;
  }

  // 자신을 호스트로 승격
  async promoteToHost(): Promise<void> {
    if (!this.currentRoomId) return;

    console.log('[PromoteToHost] 새 호스트로 승격:', this.playerId);
    await update(ref(database, `rooms/${this.currentRoomId}/players/${this.playerId}`), {
      isHost: true,
    });
  }

  async endGame(): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      status: 'ended',
    });
  }

  // 게임 종료 후 대기방으로 돌아가기
  async resetToWaitingRoom(): Promise<void> {
    if (!this.currentRoomId || !this.currentRoomState) return;

    // 모든 플레이어의 점수와 ready 상태 초기화
    const playerUpdates: Record<string, unknown> = {};
    for (const playerId of Object.keys(this.currentRoomState.players)) {
      playerUpdates[`players/${playerId}/score`] = 0;
      playerUpdates[`players/${playerId}/isReady`] = false;
    }

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      status: 'waiting',
      partyScore: 0,
      maxFruitSize: 1,
      fruits: {},
      currentFruit: null,
      currentPlayerIndex: 0,
      turnStartTime: 0,
      ...playerUpdates,
    });
  }

  async leaveRoom(): Promise<void> {
    if (!this.currentRoomId || !this.roomRef) return;

    const roomId = this.currentRoomId;
    const leavingPlayerId = this.playerId;
    const wasHost = this.isHost();

    off(this.roomRef);

    // 플레이어 제거
    await remove(ref(database, `rooms/${roomId}/players/${leavingPlayerId}`));

    // playerOrder에서도 제거 및 currentPlayerIndex 조정
    const snapshot = await get(ref(database, `rooms/${roomId}`));
    if (snapshot.exists()) {
      const roomState = snapshot.val() as RoomState;
      const newPlayerOrder = roomState.playerOrder.filter((id: string) => id !== leavingPlayerId);

      if (newPlayerOrder.length === 0) {
        // 모든 플레이어가 나감 - 방 삭제
        await remove(ref(database, `rooms/${roomId}`));
      } else {
        // playerOrder 업데이트 및 currentPlayerIndex 조정
        let newIndex = roomState.currentPlayerIndex;
        const leavingIndex = roomState.playerOrder.indexOf(leavingPlayerId);

        if (leavingIndex !== -1 && leavingIndex <= roomState.currentPlayerIndex) {
          // 퇴장한 플레이어가 현재 또는 이전 인덱스면 조정
          newIndex = Math.max(0, roomState.currentPlayerIndex - 1);
        }
        // 인덱스가 배열 범위를 벗어나지 않도록
        newIndex = newIndex % newPlayerOrder.length;

        const updates: Record<string, unknown> = {
          playerOrder: newPlayerOrder,
          currentPlayerIndex: newIndex,
        };

        // 호스트가 나가면 새 호스트 선정 (playerOrder의 첫 번째 플레이어)
        if (wasHost) {
          const newHostId = newPlayerOrder[0];
          updates[`players/${newHostId}/isHost`] = true;
          console.log('[LeaveRoom] 새 호스트 선정:', newHostId);
        }

        await update(ref(database, `rooms/${roomId}`), updates);
      }
    }

    this.currentRoomId = null;
    this.roomRef = null;
    this.roomListeners = [];
  }

  // 호스트 전용: players와 playerOrder 불일치 정리 (연결 해제된 플레이어 처리)
  async cleanupDisconnectedPlayers(): Promise<void> {
    if (!this.currentRoomId || !this.isHost()) return;

    const snapshot = await get(ref(database, `rooms/${this.currentRoomId}`));
    if (!snapshot.exists()) return;

    const roomState = snapshot.val() as RoomState;
    const activePlayers = Object.keys(roomState.players);
    const disconnectedPlayers = roomState.playerOrder.filter(
      (id: string) => !activePlayers.includes(id)
    );

    if (disconnectedPlayers.length === 0) return;

    console.log('[Host] 연결 해제된 플레이어 정리:', disconnectedPlayers);

    const newPlayerOrder = roomState.playerOrder.filter(
      (id: string) => activePlayers.includes(id)
    );

    if (newPlayerOrder.length === 0) {
      // 모든 플레이어가 나감
      await remove(ref(database, `rooms/${this.currentRoomId}`));
      return;
    }

    // currentPlayerIndex 조정
    let newIndex = roomState.currentPlayerIndex;
    for (const disconnectedId of disconnectedPlayers) {
      const disconnectedIndex = roomState.playerOrder.indexOf(disconnectedId);
      if (disconnectedIndex !== -1 && disconnectedIndex <= newIndex) {
        newIndex = Math.max(0, newIndex - 1);
      }
    }
    newIndex = newIndex % newPlayerOrder.length;

    // 현재 턴 플레이어가 나갔으면 새 턴 시작
    const currentTurnPlayer = roomState.playerOrder[roomState.currentPlayerIndex];
    const needNewTurn = disconnectedPlayers.includes(currentTurnPlayer);

    const updates: Record<string, unknown> = {
      playerOrder: newPlayerOrder,
      currentPlayerIndex: newIndex,
    };

    if (needNewTurn && roomState.status === 'playing') {
      updates.turnStartTime = Date.now();
      updates.currentFruit = {
        size: Math.floor(Math.random() * Math.min(roomState.maxFruitSize, 5)) + 1,
        x: 200,
      };
    }

    await update(ref(database, `rooms/${this.currentRoomId}`), updates);
  }

  async getRoomList(): Promise<RoomState[]> {
    console.log('[NetworkManager] getRoomList 호출');
    try {
      const roomsRef = ref(database, 'rooms');
      const snapshot = await get(roomsRef);

      console.log('[NetworkManager] snapshot exists:', snapshot.exists());

      if (!snapshot.exists()) return [];

      const rooms: RoomState[] = [];
      snapshot.forEach((child) => {
        const room = child.val() as RoomState;
        if (room.status === 'waiting') {
          rooms.push(room);
        }
      });

      console.log('[NetworkManager] 찾은 방 개수:', rooms.length);
      return rooms;
    } catch (error) {
      console.error('[NetworkManager] getRoomList 에러:', error);
      throw error;
    }
  }
}
