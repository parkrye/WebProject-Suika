import type { FruitData } from './types';

export const GAME_CONFIG = {
  TURN_TIME: 10,
  GAME_OVER_LINE_Y: 100,
  DROP_AREA_Y: 80,
  WALL_THICKNESS: 20,
  GRAVITY: 1,
} as const;

export const FRUIT_DATA: FruitData[] = [
  { size: 1, radius: 15, color: '#FF6B6B', score: 0 },
  { size: 2, radius: 22, color: '#FF8E53', score: 10 },
  { size: 3, radius: 30, color: '#FFCD56', score: 30 },
  { size: 4, radius: 40, color: '#4BC0C0', score: 80 },
  { size: 5, radius: 52, color: '#36A2EB', score: 150 },
  { size: 6, radius: 65, color: '#9966FF', score: 250 },
  { size: 7, radius: 80, color: '#FF6384', score: 400 },
  { size: 8, radius: 95, color: '#C9CBCF', score: 600 },
  { size: 9, radius: 112, color: '#7CFC00', score: 850 },
  { size: 10, radius: 130, color: '#FFD700', score: 1200 },
  { size: 11, radius: 150, color: '#FF1493', score: 1600 },
];

export function getFruitData(size: number): FruitData {
  const index = Math.min(size - 1, FRUIT_DATA.length - 1);
  return FRUIT_DATA[index];
}

export function getScoreForMerge(resultSize: number): number {
  return getFruitData(resultSize).score;
}
