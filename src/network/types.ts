export interface RoomPlayer {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  isHost: boolean;
}

export interface FruitState {
  id: string;
  x: number;
  y: number;
  size: number;
  isDropped: boolean;
}

export interface DropRequest {
  id: string;
  playerId: string;
  x: number;
  size: number;
  timestamp: number;
}

export interface RoomState {
  id: string;
  status: 'waiting' | 'playing' | 'ended';
  players: Record<string, RoomPlayer>;
  playerOrder: string[];
  currentPlayerIndex: number;
  turnStartTime: number;
  partyScore: number;
  maxFruitSize: number;
  fruits: Record<string, FruitState>;
  currentFruit: {
    size: number;
    x: number;
  } | null;
  dropRequest?: DropRequest | null;
  createdAt: number;
}

export interface GameAction {
  type: 'move' | 'drop' | 'merge' | 'game_over';
  playerId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type RoomEventCallback = (room: RoomState) => void;
export type ActionEventCallback = (action: GameAction) => void;
