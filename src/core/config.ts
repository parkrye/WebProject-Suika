import type { FruitData } from './types';

export const GAME_CONFIG = {
  TURN_TIME: 10,
  GAME_OVER_LINE_Y: 100,
  LAUNCH_AREA_Y: 540,        // 발사 위치 (바닥에서 60px 위)
  LAUNCH_VELOCITY_Y: -18,    // 발사 초기 속도 (위쪽)
  DROP_AREA_Y: 80,           // 레거시 호환용 (싱글플레이어)
  WALL_THICKNESS: 20,
  GRAVITY: 1,
} as const;

// 불꽃놀이 테마 색상
export const FRUIT_DATA: FruitData[] = [
  { size: 1, radius: 15, color: '#FF6B9D', score: 0, image: '/fireworks/firework_1.png' },
  { size: 2, radius: 22, color: '#FF9A56', score: 10, image: '/fireworks/firework_2.png' },
  { size: 3, radius: 30, color: '#FFCC00', score: 30, image: '/fireworks/firework_3.png' },
  { size: 4, radius: 40, color: '#4BC0C0', score: 80, image: '/fireworks/firework_4.png' },
  { size: 5, radius: 52, color: '#36A2EB', score: 150, image: '/fireworks/firework_5.png' },
  { size: 6, radius: 65, color: '#A855F7', score: 250, image: '/fireworks/firework_6.png' },
  { size: 7, radius: 80, color: '#EC4899', score: 400, image: '/fireworks/firework_7.png' },
  { size: 8, radius: 95, color: '#10B981', score: 600, image: '/fireworks/firework_8.png' },
  { size: 9, radius: 112, color: '#F59E0B', score: 850, image: '/fireworks/firework_9.png' },
  { size: 10, radius: 130, color: '#FFD700', score: 1200, image: '/fireworks/firework_10.png' },
];

export const MAX_FRUIT_SIZE = 10;
export const SETTLE_FRAMES = 15; // 과일 안정화 대기 프레임 (거의 즉시)

export function getFruitData(size: number): FruitData {
  const index = Math.min(size - 1, FRUIT_DATA.length - 1);
  return FRUIT_DATA[index];
}

export function getScoreForMerge(resultSize: number): number {
  return getFruitData(resultSize).score;
}
