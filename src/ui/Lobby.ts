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
        <h1 class="lobby-title">Multi Suika Game</h1>

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
        font-size: 48px;
        margin-bottom: 40px;
        color: #e94560;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
      }
      .lobby-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
        background: rgba(0,0,0,0.3);
        padding: 30px;
        border-radius: 16px;
        min-width: 300px;
      }
      .welcome-text {
        font-size: 18px;
        margin-bottom: 10px;
      }
      .btn {
        padding: 12px 24px;
        font-size: 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 0.2s, opacity 0.2s;
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
        background: #e94560;
        color: white;
      }
      .btn-secondary {
        background: #4a4a6a;
        color: white;
      }
      .btn-success {
        background: #4BC0C0;
        color: white;
      }
      .btn-danger {
        background: #ff4757;
        color: white;
      }
      input[type="text"] {
        padding: 12px 16px;
        font-size: 16px;
        border: 2px solid #4a4a6a;
        border-radius: 8px;
        background: #2a2a3e;
        color: white;
        outline: none;
        width: 200px;
      }
      input[type="text"]:focus {
        border-color: #e94560;
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
        background: #2a2a3e;
        border-radius: 8px;
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
        background: #2a2a3e;
        border-radius: 8px;
      }
      .player-item.ready {
        border: 2px solid #4BC0C0;
      }
      .player-item.host::before {
        content: "👑 ";
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
        background: rgba(0,0,0,0.7);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .modal-content {
        background: #1a1a2e;
        padding: 30px;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        gap: 15px;
        align-items: center;
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

      roomList.innerHTML = rooms
        .map(
          (room) => `
        <div class="room-item">
          <span>${room.id.substring(0, 8)}... (${Object.keys(room.players).length}/6)</span>
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
      roomList.innerHTML = '<p>Failed to load rooms</p>';
    }
  }

  private showWaitingRoom(roomId: string): void {
    document.getElementById('menu-section')!.style.display = 'none';
    document.getElementById('waiting-room-section')!.style.display = 'flex';
    document.getElementById('room-id-display')!.textContent = roomId.substring(0, 8);

    this.network!.onRoomUpdate((room) => this.updateWaitingRoom(room));
  }

  private updateWaitingRoom(room: RoomState): void {
    if (room.status === 'playing' && this.onGameStart && this.network) {
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
        <span>${player.isReady ? '✓ Ready' : 'Waiting...'}</span>
      </div>
    `
      )
      .join('');

    const currentPlayer = room.players[this.network!.id];
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement;

    if (currentPlayer?.isHost) {
      const allReady = players.every((p) => p.isReady || p.isHost);
      const enoughPlayers = players.length >= 1;
      startBtn.style.display = 'block';
      startBtn.disabled = !allReady || !enoughPlayers;
    } else {
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
