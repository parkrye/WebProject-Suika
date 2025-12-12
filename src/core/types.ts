export interface GameConfig {
  width: number;
  height: number;
}

export interface FruitData {
  size: number;
  radius: number;
  color: string;
  score: number;
}

export interface Player {
  id: string;
  name: string;
  score: number;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  partyScore: number;
  maxFruitSize: number;
  isGameOver: boolean;
}

export interface TurnState {
  timeRemaining: number;
  currentFruitSize: number;
  dropX: number;
}
