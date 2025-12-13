import { AudioManager } from '../core/AudioManager';

export class AudioControl {
  private container: HTMLElement;
  private audio: AudioManager;
  private isExpanded = false;

  constructor() {
    this.audio = AudioManager.getInstance();
    this.container = this.createUI();
    document.body.appendChild(this.container);
    this.loadSettings();
  }

  private createUI(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'audio-control';
    container.innerHTML = `
      <button class="audio-toggle-btn" title="Sound Settings">
        <span class="audio-icon">🔊</span>
      </button>
      <div class="audio-panel">
        <div class="audio-panel-header">Sound Settings</div>
        <div class="audio-slider-group">
          <label>
            <span class="slider-label">BGM</span>
            <input type="range" class="audio-slider" id="bgm-slider" min="0" max="100" value="50">
            <span class="slider-value" id="bgm-value">50%</span>
          </label>
        </div>
        <div class="audio-slider-group">
          <label>
            <span class="slider-label">SFX</span>
            <input type="range" class="audio-slider" id="sfx-slider" min="0" max="100" value="70">
            <span class="slider-value" id="sfx-value">70%</span>
          </label>
        </div>
        <button class="mute-btn" id="mute-btn">
          <span class="mute-icon">🔊</span>
          <span class="mute-text">Mute All</span>
        </button>
      </div>
    `;

    this.setupEventListeners(container);
    return container;
  }

  private setupEventListeners(container: HTMLElement): void {
    const toggleBtn = container.querySelector('.audio-toggle-btn') as HTMLButtonElement;
    const panel = container.querySelector('.audio-panel') as HTMLElement;
    const bgmSlider = container.querySelector('#bgm-slider') as HTMLInputElement;
    const sfxSlider = container.querySelector('#sfx-slider') as HTMLInputElement;
    const bgmValue = container.querySelector('#bgm-value') as HTMLSpanElement;
    const sfxValue = container.querySelector('#sfx-value') as HTMLSpanElement;
    const muteBtn = container.querySelector('#mute-btn') as HTMLButtonElement;

    toggleBtn.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      panel.classList.toggle('expanded', this.isExpanded);
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target as Node) && this.isExpanded) {
        this.isExpanded = false;
        panel.classList.remove('expanded');
      }
    });

    bgmSlider.addEventListener('input', () => {
      const value = parseInt(bgmSlider.value);
      bgmValue.textContent = `${value}%`;
      this.audio.setBGMVolume(value / 100);
      this.saveSettings();
    });

    sfxSlider.addEventListener('input', () => {
      const value = parseInt(sfxSlider.value);
      sfxValue.textContent = `${value}%`;
      this.audio.setSFXVolume(value / 100);
      this.saveSettings();
    });

    muteBtn.addEventListener('click', () => {
      const isMuted = this.audio.toggleMute();
      this.updateMuteUI(isMuted);
      this.saveSettings();
    });
  }

  private updateMuteUI(isMuted: boolean): void {
    const toggleBtn = this.container.querySelector('.audio-toggle-btn .audio-icon') as HTMLSpanElement;
    const muteIcon = this.container.querySelector('.mute-icon') as HTMLSpanElement;
    const muteText = this.container.querySelector('.mute-text') as HTMLSpanElement;

    if (isMuted) {
      toggleBtn.textContent = '🔇';
      muteIcon.textContent = '🔇';
      muteText.textContent = 'Unmute';
    } else {
      toggleBtn.textContent = '🔊';
      muteIcon.textContent = '🔊';
      muteText.textContent = 'Mute All';
    }
  }

  private saveSettings(): void {
    const bgmSlider = this.container.querySelector('#bgm-slider') as HTMLInputElement;
    const sfxSlider = this.container.querySelector('#sfx-slider') as HTMLInputElement;

    const settings = {
      bgmVolume: parseInt(bgmSlider.value),
      sfxVolume: parseInt(sfxSlider.value),
      isMuted: this.audio.isSoundMuted(),
    };

    localStorage.setItem('audioSettings', JSON.stringify(settings));
  }

  private loadSettings(): void {
    const saved = localStorage.getItem('audioSettings');
    if (!saved) return;

    try {
      const settings = JSON.parse(saved);

      const bgmSlider = this.container.querySelector('#bgm-slider') as HTMLInputElement;
      const sfxSlider = this.container.querySelector('#sfx-slider') as HTMLInputElement;
      const bgmValue = this.container.querySelector('#bgm-value') as HTMLSpanElement;
      const sfxValue = this.container.querySelector('#sfx-value') as HTMLSpanElement;

      if (settings.bgmVolume !== undefined) {
        bgmSlider.value = settings.bgmVolume.toString();
        bgmValue.textContent = `${settings.bgmVolume}%`;
        this.audio.setBGMVolume(settings.bgmVolume / 100);
      }

      if (settings.sfxVolume !== undefined) {
        sfxSlider.value = settings.sfxVolume.toString();
        sfxValue.textContent = `${settings.sfxVolume}%`;
        this.audio.setSFXVolume(settings.sfxVolume / 100);
      }

      if (settings.isMuted) {
        this.audio.setMute(true);
        this.updateMuteUI(true);
      }
    } catch {
      console.warn('Failed to load audio settings');
    }
  }
}
