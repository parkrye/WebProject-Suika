export const SOUND_CONFIG = {
  BGM: {
    MAIN: '/bgm/main.mp3',
    LOBBY: '/bgm/lobby.mp3',
  },
  SFX: {
    DROP: '/sfx/drop.mp3',
    MERGE: '/sfx/merge.mp3',
    GAMEOVER: '/sfx/gameover.mp3',
    TURN_START: '/sfx/turn_start.mp3',
    CLICK: '/sfx/click.mp3',
  },
} as const;

export class AudioManager {
  private static instance: AudioManager;
  private bgm: HTMLAudioElement | null = null;
  private sfxCache: Map<string, HTMLAudioElement> = new Map();
  private bgmVolume = 0.5;
  private sfxVolume = 0.7;
  private isMuted = false;
  private isUnlocked = false;
  private pendingBGM: keyof typeof SOUND_CONFIG.BGM | null = null;

  private constructor() {
    this.preloadSounds();
    this.setupUnlockListener();
  }

  private setupUnlockListener(): void {
    const unlock = () => {
      if (this.isUnlocked) return;
      this.isUnlocked = true;

      // 대기 중인 BGM이 있으면 재생
      if (this.pendingBGM) {
        this.playBGM(this.pendingBGM);
        this.pendingBGM = null;
      }

      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };

    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('keydown', unlock);
  }

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  private preloadSounds(): void {
    Object.values(SOUND_CONFIG.SFX).forEach((path) => {
      const audio = new Audio();
      audio.src = path;
      audio.preload = 'auto';
      this.sfxCache.set(path, audio);
    });
  }

  playBGM(track: keyof typeof SOUND_CONFIG.BGM): void {
    // 아직 사용자 상호작용이 없으면 대기
    if (!this.isUnlocked) {
      this.pendingBGM = track;
      return;
    }

    if (this.bgm) {
      this.bgm.pause();
    }

    const path = SOUND_CONFIG.BGM[track];
    this.bgm = new Audio(path);
    this.bgm.loop = true;
    this.bgm.volume = this.isMuted ? 0 : this.bgmVolume;
    this.bgm.play().catch(() => {
      console.warn('BGM autoplay blocked. User interaction required.');
    });
  }

  stopBGM(): void {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
    }
  }

  playSFX(sound: keyof typeof SOUND_CONFIG.SFX): void {
    if (this.isMuted) return;

    const path = SOUND_CONFIG.SFX[sound];
    const cached = this.sfxCache.get(path);

    if (cached) {
      const clone = cached.cloneNode() as HTMLAudioElement;
      clone.volume = this.sfxVolume;
      clone.play().catch(() => {});
    }
  }

  setBGMVolume(volume: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    if (this.bgm) {
      this.bgm.volume = this.isMuted ? 0 : this.bgmVolume;
    }
  }

  setSFXVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.bgm) {
      this.bgm.volume = this.isMuted ? 0 : this.bgmVolume;
    }
    return this.isMuted;
  }

  setMute(muted: boolean): void {
    this.isMuted = muted;
    if (this.bgm) {
      this.bgm.volume = this.isMuted ? 0 : this.bgmVolume;
    }
  }

  isSoundMuted(): boolean {
    return this.isMuted;
  }
}
