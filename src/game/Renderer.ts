import { GAME_CONFIG } from '../core/config';
import type { Fruit } from './Fruit';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawGameOverLine(): void {
    this.ctx.strokeStyle = '#e94560';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([10, 10]);
    this.ctx.beginPath();
    this.ctx.moveTo(0, GAME_CONFIG.GAME_OVER_LINE_Y);
    this.ctx.lineTo(this.width, GAME_CONFIG.GAME_OVER_LINE_Y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  drawFruit(fruit: Fruit): void {
    const { x, y, radius, color, size } = fruit;

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff33';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = '#fff';
    this.ctx.font = `bold ${Math.max(12, radius * 0.6)}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(size.toString(), x, y);
  }

  drawDropIndicator(x: number): void {
    this.ctx.strokeStyle = '#ffffff44';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, GAME_CONFIG.DROP_AREA_Y);
    this.ctx.lineTo(x, this.height);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  drawWalls(): void {
    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(0, 0, 4, this.height);
    this.ctx.fillRect(this.width - 4, 0, 4, this.height);
    this.ctx.fillRect(0, this.height - 4, this.width, 4);
  }

  render(fruits: Fruit[], dropX: number, previewFruit: Fruit | null): void {
    this.clear();
    this.drawWalls();
    this.drawGameOverLine();
    this.drawDropIndicator(dropX);

    for (const fruit of fruits) {
      this.drawFruit(fruit);
    }

    if (previewFruit) {
      this.drawFruit(previewFruit);
    }
  }
}
