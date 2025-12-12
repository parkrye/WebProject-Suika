import Matter from 'matter-js';
import { GAME_CONFIG } from './config';

export class Physics {
  engine: Matter.Engine;
  world: Matter.World;
  private runner: Matter.Runner | null = null;

  constructor() {
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.engine.world.gravity.y = GAME_CONFIG.GRAVITY;
  }

  createWalls(width: number, height: number): Matter.Body[] {
    const thickness = GAME_CONFIG.WALL_THICKNESS;

    const floor = Matter.Bodies.rectangle(
      width / 2,
      height + thickness / 2,
      width + thickness * 2,
      thickness,
      { isStatic: true, label: 'floor' }
    );

    const leftWall = Matter.Bodies.rectangle(
      -thickness / 2,
      height / 2,
      thickness,
      height * 2,
      { isStatic: true, label: 'wall' }
    );

    const rightWall = Matter.Bodies.rectangle(
      width + thickness / 2,
      height / 2,
      thickness,
      height * 2,
      { isStatic: true, label: 'wall' }
    );

    const walls = [floor, leftWall, rightWall];
    Matter.Composite.add(this.world, walls);
    return walls;
  }

  createCircle(x: number, y: number, radius: number, options?: Matter.IBodyDefinition): Matter.Body {
    const body = Matter.Bodies.circle(x, y, radius, {
      restitution: 0.2,
      friction: 0.5,
      ...options,
    });
    Matter.Composite.add(this.world, body);
    return body;
  }

  removeBody(body: Matter.Body): void {
    Matter.Composite.remove(this.world, body);
  }

  onCollision(callback: (pairs: Matter.Pair[]) => void): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      callback(event.pairs);
    });
  }

  start(): void {
    this.runner = Matter.Runner.create();
    Matter.Runner.run(this.runner, this.engine);
  }

  stop(): void {
    if (this.runner) {
      Matter.Runner.stop(this.runner);
    }
  }

  update(delta: number = 1000 / 60): void {
    Matter.Engine.update(this.engine, delta);
  }
}
