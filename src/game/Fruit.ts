import Matter from 'matter-js';
import { getFruitData } from '../core/config';
import type { FruitData } from '../core/types';

export class Fruit {
  body: Matter.Body;
  size: number;
  data: FruitData;
  isDropped: boolean = false;

  constructor(body: Matter.Body, size: number) {
    this.body = body;
    this.size = size;
    this.data = getFruitData(size);
    this.body.label = `fruit_${size}`;
    (this.body as Matter.Body & { fruitSize: number }).fruitSize = size;
  }

  get x(): number {
    return this.body.position.x;
  }

  get y(): number {
    return this.body.position.y;
  }

  get radius(): number {
    return this.data.radius;
  }

  get color(): string {
    return this.data.color;
  }

  setPosition(x: number, y: number): void {
    Matter.Body.setPosition(this.body, { x, y });
  }

  setStatic(isStatic: boolean): void {
    Matter.Body.setStatic(this.body, isStatic);
  }

  drop(): void {
    this.isDropped = true;
    this.setStatic(false);
  }
}
