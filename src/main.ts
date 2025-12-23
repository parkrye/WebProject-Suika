import { Lobby } from './ui/Lobby';
import { NetworkManager, GameSync } from './network';
import { MultiplayerGame } from './game/MultiplayerGame';
import { AudioControl } from './ui/AudioControl';

const VERSION_KEY = 'app_build_version';

async function checkVersion(): Promise<void> {
  try {
    const response = await fetch('/version.json?t=' + Date.now());
    if (!response.ok) return;

    const { buildTime } = await response.json();
    const storedVersion = localStorage.getItem(VERSION_KEY);

    if (storedVersion && storedVersion !== String(buildTime)) {
      localStorage.setItem(VERSION_KEY, String(buildTime));

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }

      window.location.reload();
      return;
    }

    localStorage.setItem(VERSION_KEY, String(buildTime));
  } catch {
    // version.json이 없는 개발 환경에서는 무시
  }
}

checkVersion();

const appContainer = document.getElementById('app')!;

// 모든 페이지에서 표시되는 오디오 컨트롤
new AudioControl();

const lobby = new Lobby(appContainer);

lobby.setOnGameStart((network: NetworkManager) => {
  startMultiplayerGame(network);
});

function startMultiplayerGame(network: NetworkManager): void {
  appContainer.innerHTML = `
    <div id="game-container" style="display: flex; flex-direction: column; align-items: center; padding: 20px;">
      <canvas id="game-canvas" style="border: 4px solid #e94560; border-radius: 8px; touch-action: none;"></canvas>
    </div>
  `;

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const sync = new GameSync(network);

  const game = new MultiplayerGame(canvas, sync);
  game.start();
}
