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
    if (playerCount >= 6) {
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

  async nextTurn(nextFruitSize: number): Promise<void> {
    if (!this.currentRoomId) return;

    const roomRef = ref(database, `rooms/${this.currentRoomId}`);
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) return;

    const roomState = snapshot.val() as RoomState;
    const nextIndex = (roomState.currentPlayerIndex + 1) % roomState.playerOrder.length;

    await update(roomRef, {
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

  async endGame(): Promise<void> {
    if (!this.currentRoomId) return;

    await update(ref(database, `rooms/${this.currentRoomId}`), {
      status: 'ended',
    });
  }

  async leaveRoom(): Promise<void> {
    if (!this.currentRoomId || !this.roomRef) return;

    off(this.roomRef);

    await remove(ref(database, `rooms/${this.currentRoomId}/players/${this.playerId}`));

    const snapshot = await get(ref(database, `rooms/${this.currentRoomId}/players`));
    if (!snapshot.exists() || Object.keys(snapshot.val()).length === 0) {
      await remove(ref(database, `rooms/${this.currentRoomId}`));
    }

    this.currentRoomId = null;
    this.roomRef = null;
    this.roomListeners = [];
  }

  async getRoomList(): Promise<RoomState[]> {
    const roomsRef = ref(database, 'rooms');
    const snapshot = await get(roomsRef);

    if (!snapshot.exists()) return [];

    const rooms: RoomState[] = [];
    snapshot.forEach((child) => {
      const room = child.val() as RoomState;
      if (room.status === 'waiting') {
        rooms.push(room);
      }
    });

    return rooms;
  }
}
