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

// 현재 게임 인스턴스 추적
let currentGame: MultiplayerGame | null = null;

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
  currentGame = game;

  // Play Again 콜백 설정
  game.setOnPlayAgain(async () => {
    console.log('[Main] Play Again 클릭, 대기방으로 돌아가기');

    // 게임 정리
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }

    // 호스트만 방 상태 리셋 (다른 플레이어는 자동으로 업데이트 받음)
    if (network.isHost()) {
      await network.resetToWaitingRoom();
    }

    // 로비 UI로 돌아가기
    lobby.returnToWaitingRoom(network);
  });

  game.start();
}
