import { Lobby } from './ui/Lobby';
import { NetworkManager, GameSync } from './network';
import { MultiplayerGame } from './game/MultiplayerGame';
import { AudioControl } from './ui/AudioControl';

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
      <canvas id="game-canvas" style="border: 4px solid #e94560; border-radius: 8px;"></canvas>
      <div id="controls" style="display:flex; justify-content:center; gap:10px; margin-top:15px;">
        <button id="btn-left" class="control-btn">&lt;</button>
        <button id="btn-drop" class="control-btn btn-drop">DROP</button>
        <button id="btn-right" class="control-btn">&gt;</button>
      </div>
    </div>
  `;

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const sync = new GameSync(network);

  const game = new MultiplayerGame(canvas, sync);
  game.start();
}
