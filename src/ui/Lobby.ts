import { NetworkManager } from '../network/NetworkManager';
import type { RoomState } from '../network/types';

export class Lobby {
  private container: HTMLElement;
  private network: NetworkManager | null = null;
  private onGameStart: ((network: NetworkManager) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="lobby">
        <h1 class="lobby-title">Fireworks Festival</h1>

        <div id="name-input-section" class="lobby-section">
          <input type="text" id="player-name" placeholder="Enter your name" maxlength="12" />
          <button id="confirm-name-btn" class="btn btn-primary">Confirm</button>
        </div>

        <div id="menu-section" class="lobby-section" style="display: none;">
          <p class="welcome-text">Welcome, <span id="display-name"></span>!</p>
          <button id="create-room-btn" class="btn btn-primary">Create Room</button>
          <button id="join-room-btn" class="btn btn-secondary">Join Room</button>
          <button id="refresh-rooms-btn" class="btn btn-secondary">Refresh Rooms</button>
          <div id="room-list" class="room-list"></div>
        </div>

        <div id="waiting-room-section" class="lobby-section" style="display: none;">
          <h2>Room: <span id="room-id-display"></span></h2>
          <div id="players-list" class="players-list"></div>
          <div class="waiting-room-actions">
            <button id="ready-btn" class="btn btn-primary">Ready</button>
            <button id="start-btn" class="btn btn-success" style="display: none;">Start Game</button>
            <button id="leave-room-btn" class="btn btn-danger">Leave</button>
          </div>
        </div>

        <div id="join-room-modal" class="modal" style="display: none;">
          <div class="modal-content">
            <h3>Join Room</h3>
            <input type="text" id="room-code-input" placeholder="Enter room code" />
            <div class="modal-actions">
              <button id="confirm-join-btn" class="btn btn-primary">Join</button>
              <button id="cancel-join-btn" class="btn btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachStyles();
    this.attachEventListeners();
  }

  private attachStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .lobby {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 40px;
        color: white;
        min-height: 100vh;
      }
      .lobby-title {
        font-size: 52px;
        margin-bottom: 40px;
        background: linear-gradient(135deg, #ff6b9d, #ffcc00, #ff9a56);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-shadow: none;
        filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.5));
        text-align: center;
        width: 100%;
      }
      .lobby-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
        background: linear-gradient(135deg, rgba(30,20,50,0.8), rgba(50,30,70,0.8));
        padding: 30px;
        border-radius: 16px;
        min-width: 300px;
        border: 2px solid rgba(255,107,157,0.3);
        box-shadow: 0 0 30px rgba(255,107,157,0.2);
      }
      .welcome-text {
        font-size: 18px;
        margin-bottom: 10px;
        color: #ffcc00;
      }
      .btn {
        padding: 12px 24px;
        font-size: 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        min-width: 150px;
      }
      .btn:hover {
        transform: scale(1.05);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .btn-primary {
        background: linear-gradient(135deg, #ff6b9d, #ff9a56);
        color: white;
        box-shadow: 0 0 15px rgba(255,107,157,0.4);
      }
      .btn-primary:hover {
        box-shadow: 0 0 25px rgba(255,107,157,0.6);
      }
      .btn-secondary {
        background: linear-gradient(135deg, #4a4a7a, #3a3a6a);
        color: white;
      }
      .btn-success {
        background: linear-gradient(135deg, #4BC0C0, #36A2EB);
        color: white;
        box-shadow: 0 0 15px rgba(75,192,192,0.4);
      }
      .btn-success:hover {
        box-shadow: 0 0 25px rgba(75,192,192,0.6);
      }
      .btn-danger {
        background: linear-gradient(135deg, #ff4757, #ff6b81);
        color: white;
      }
      input[type="text"] {
        padding: 12px 16px;
        font-size: 16px;
        border: 2px solid rgba(255,107,157,0.3);
        border-radius: 8px;
        background: rgba(30,20,50,0.8);
        color: white;
        outline: none;
        width: 200px;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      input[type="text"]:focus {
        border-color: #ff6b9d;
        box-shadow: 0 0 15px rgba(255,107,157,0.3);
      }
      .room-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 200px;
        overflow-y: auto;
        width: 100%;
      }
      .room-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        background: rgba(40,30,60,0.8);
        border-radius: 8px;
        border: 1px solid rgba(255,107,157,0.2);
      }
      .room-item button {
        padding: 6px 12px;
        font-size: 14px;
      }
      .players-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        margin: 15px 0;
      }
      .player-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
        background: rgba(40,30,60,0.8);
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .player-item.ready {
        border: 2px solid #4BC0C0;
        box-shadow: 0 0 10px rgba(75,192,192,0.3);
      }
      .player-item.host {
        border: 2px solid #ffcc00;
        box-shadow: 0 0 10px rgba(255,204,0,0.3);
      }
      .waiting-room-actions {
        display: flex;
        gap: 10px;
        margin-top: 10px;
      }
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 100;
      }
      .modal-content {
        background: linear-gradient(135deg, #1a1a3a, #2a1a4a);
        padding: 30px;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        gap: 15px;
        align-items: center;
        border: 2px solid rgba(255,107,157,0.3);
        box-shadow: 0 0 40px rgba(255,107,157,0.3);
      }
      .modal-actions {
        display: flex;
        gap: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  private attachEventListeners(): void {
    const confirmNameBtn = document.getElementById('confirm-name-btn')!;
    const createRoomBtn = document.getElementById('create-room-btn')!;
    const joinRoomBtn = document.getElementById('join-room-btn')!;
    const refreshRoomsBtn = document.getElementById('refresh-rooms-btn')!;
    const readyBtn = document.getElementById('ready-btn')!;
    const startBtn = document.getElementById('start-btn')!;
    const leaveRoomBtn = document.getElementById('leave-room-btn')!;
    const confirmJoinBtn = document.getElementById('confirm-join-btn')!;
    const cancelJoinBtn = document.getElementById('cancel-join-btn')!;

    confirmNameBtn.addEventListener('click', () => this.confirmName());
    createRoomBtn.addEventListener('click', () => this.createRoom());
    joinRoomBtn.addEventListener('click', () => this.showJoinModal());
    refreshRoomsBtn.addEventListener('click', () => this.refreshRooms());
    readyBtn.addEventListener('click', () => this.toggleReady());
    startBtn.addEventListener('click', () => this.startGame());
    leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
    confirmJoinBtn.addEventListener('click', () => this.confirmJoinRoom());
    cancelJoinBtn.addEventListener('click', () => this.hideJoinModal());

    document.getElementById('player-name')!.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.confirmName();
    });
  }

  private confirmName(): void {
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    const name = nameInput.value.trim();

    if (name.length < 1) {
      alert('Please enter a name');
      return;
    }

    this.network = new NetworkManager(name);
    document.getElementById('display-name')!.textContent = name;
    document.getElementById('name-input-section')!.style.display = 'none';
    document.getElementById('menu-section')!.style.display = 'flex';

    this.refreshRooms();
  }

  private async createRoom(): Promise<void> {
    if (!this.network) return;

    try {
      const roomId = await this.network.createRoom();
      this.showWaitingRoom(roomId);
    } catch (error) {
      alert('Failed to create room');
      console.error(error);
    }
  }

  private showJoinModal(): void {
    document.getElementById('join-room-modal')!.style.display = 'flex';
  }

  private hideJoinModal(): void {
    document.getElementById('join-room-modal')!.style.display = 'none';
  }

  private async confirmJoinRoom(): Promise<void> {
    if (!this.network) return;

    const roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
    const roomId = roomCodeInput.value.trim();

    if (!roomId) {
      alert('Please enter a room code');
      return;
    }

    try {
      await this.network.joinRoom(roomId);
      this.hideJoinModal();
      this.showWaitingRoom(roomId);
    } catch (error) {
      alert((error as Error).message || 'Failed to join room');
    }
  }

  private async refreshRooms(): Promise<void> {
    if (!this.network) return;

    const roomList = document.getElementById('room-list')!;
    roomList.innerHTML = '<p>Loading...</p>';

    try {
      const rooms = await this.network.getRoomList();

      if (rooms.length === 0) {
        roomList.innerHTML = '<p>No rooms available</p>';
        return;
      }

      const validRooms = rooms.filter((room) => room && room.players && Object.keys(room.players).length > 0);

      if (validRooms.length === 0) {
        roomList.innerHTML = '<p>No rooms available</p>';
        return;
      }

      roomList.innerHTML = validRooms
        .map(
          (room) => `
        <div class="room-item">
          <span>${room.id.substring(0, 8)}... (${Object.keys(room.players).length}/10)</span>
          <button class="btn btn-primary join-room-item" data-room-id="${room.id}">Join</button>
        </div>
      `
        )
        .join('');

      roomList.querySelectorAll('.join-room-item').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const roomId = (e.target as HTMLElement).dataset.roomId!;
          try {
            await this.network!.joinRoom(roomId);
            this.showWaitingRoom(roomId);
          } catch (error) {
            alert((error as Error).message || 'Failed to join room');
          }
        });
      });
    } catch (error) {
      console.error('[Lobby] Failed to load rooms:', error);
      roomList.innerHTML = '<p>Failed to load rooms</p>';
    }
  }

  private showWaitingRoom(roomId: string): void {
    document.getElementById('menu-section')!.style.display = 'none';
    document.getElementById('waiting-room-section')!.style.display = 'flex';
    document.getElementById('room-id-display')!.textContent = roomId.substring(0, 8);

    this.network!.onRoomUpdate((room) => this.updateWaitingRoom(room));
  }

  private gameStarted = false;

  private updateWaitingRoom(room: RoomState): void {
    // 이미 게임이 시작됐으면 무시 (중복 방지)
    if (this.gameStarted) return;

    if (room.status === 'playing' && this.onGameStart && this.network) {
      this.gameStarted = true; // 한 번만 실행되도록
      this.container.innerHTML = '';
      this.onGameStart(this.network);
      return;
    }

    const playersList = document.getElementById('players-list');
    if (!playersList) return;

    const players = Object.values(room.players);

    playersList.innerHTML = players
      .map(
        (player) => `
      <div class="player-item ${player.isReady ? 'ready' : ''} ${player.isHost ? 'host' : ''}">
        <span>${player.name}</span>
        <span>${player.isHost ? '👑 Host' : player.isReady ? '✓ Ready' : 'Waiting...'}</span>
      </div>
    `
      )
      .join('');

    const currentPlayer = room.players[this.network!.id];
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    const readyBtn = document.getElementById('ready-btn') as HTMLButtonElement;

    if (currentPlayer?.isHost) {
      // 방장은 Ready 버튼 숨김, Start 버튼만 표시
      readyBtn.style.display = 'none';
      startBtn.style.display = 'block';

      // 혼자면 바로 시작 가능, 아니면 다른 플레이어 모두 준비되면 활성화
      const otherPlayers = players.filter((p) => !p.isHost);
      const canStart = otherPlayers.length === 0 || otherPlayers.every((p) => p.isReady);
      startBtn.disabled = !canStart;
    } else {
      // 일반 플레이어는 Ready 버튼 표시, Start 버튼 숨김
      readyBtn.style.display = 'block';
      startBtn.style.display = 'none';
    }
  }

  private isReady = false;

  private async toggleReady(): Promise<void> {
    if (!this.network) return;

    this.isReady = !this.isReady;
    await this.network.setReady(this.isReady);

    const readyBtn = document.getElementById('ready-btn')!;
    readyBtn.textContent = this.isReady ? 'Not Ready' : 'Ready';
    readyBtn.className = this.isReady ? 'btn btn-secondary' : 'btn btn-primary';
  }

  private async startGame(): Promise<void> {
    if (!this.network) return;

    await this.network.startGame();
  }

  private async leaveRoom(): Promise<void> {
    if (!this.network) return;

    await this.network.leaveRoom();
    document.getElementById('waiting-room-section')!.style.display = 'none';
    document.getElementById('menu-section')!.style.display = 'flex';
    this.isReady = false;
    this.refreshRooms();
  }

  setOnGameStart(callback: (network: NetworkManager) => void): void {
    this.onGameStart = callback;
  }
}
