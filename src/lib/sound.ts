// Web Audio API Sound Synthesizer for Games
class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playClick() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  playDiceRoll() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(220 + Math.random() * 200, this.ctx.currentTime);
          gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + 0.08);
        }, i * 80);
      }
    } catch {}
  }

  playStep() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, this.ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch {}
  }

  playLadder() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const notes = [392, 440, 523, 587, 659, 783];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
          gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + 0.15);
        }, idx * 70);
      });
    } catch {}
  }

  playSnake() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.45);
      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.45);
    } catch {}
  }

  playVictory() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const fanfare = [
        { f: 523.25, d: 150 }, // C5
        { f: 523.25, d: 150 }, // C5
        { f: 523.25, d: 150 }, // C5
        { f: 659.25, d: 400 }, // E5
        { f: 783.99, d: 600 }, // G5
        { f: 1046.5, d: 800 }, // C6
      ];
      let delay = 0;
      fanfare.forEach(item => {
        setTimeout(() => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(item.f, this.ctx.currentTime);
          gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + item.d / 1000);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + item.d / 1000);
        }, delay);
        delay += item.d + 30;
      });
    } catch {}
  }

  playPurchase() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const notes = [659, 880, 1046];
      notes.forEach((freq, i) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
          gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          osc.stop(this.ctx.currentTime + 0.12);
        }, i * 90);
      });
    } catch {}
  }

  private createNoiseBurst(durationSec: number): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  playSnowCarve() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const duration = 0.085;
      const noise = this.createNoiseBurst(duration);
      if (!noise) return;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1450, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(920, this.ctx.currentTime + duration);
      filter.Q.setValueAtTime(1.8, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.055, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.008, this.ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
      noise.stop(this.ctx.currentTime + duration);
    } catch {}
  }

  playSnowJump(isRamp = false) {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const duration = isRamp ? 0.22 : 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isRamp ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(isRamp ? 330 : 290, now);
      osc.frequency.exponentialRampToValueAtTime(isRamp ? 880 : 640, now + duration);
      gain.gain.setValueAtTime(isRamp ? 0.16 : 0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }

  playObstacleHit(kind?: string) {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      if (kind === 'ice_patch') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(980, now);
        osc.frequency.exponentialRampToValueAtTime(620, now + 0.14);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.008, now + 0.14);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
        return;
      }

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = kind === 'rock' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'snow_mound' ? 210 : 165, now);
      osc.frequency.exponentialRampToValueAtTime(58, now + 0.2);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {}
  }

  playAvalancheWarning() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const pulses = [246.94, 311.13];
      pulses.forEach((freq, idx) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.16);
        }, idx * 140);
      });
    } catch {}
  }

  playSnowTumble() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const duration = 0.38;

      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(64, now + duration);
      oscGain.gain.setValueAtTime(0.15, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);

      const noise = this.createNoiseBurst(duration);
      if (noise) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(680, now);
        filter.frequency.exponentialRampToValueAtTime(220, now + duration);
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.14, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(now);
        noise.stop(now + duration);
      }
    } catch {}
  }

  playSnowRecovery() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.13);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.13);
        }, idx * 70);
      });
    } catch {}
  }

  // --- Snow Rush: Avalanche Escape (Step 4.4 Local Battle Items SFX) ---

  private playToneStep(
    freq: number,
    type: OscillatorType,
    durationSec: number,
    peakGain: number
  ) {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + durationSec);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + durationSec);
    } catch {}
  }

  private playFilteredNoise(
    durationSec: number,
    filterType: BiquadFilterType,
    cutoffHz: number,
    peakGain: number
  ) {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const noise = this.createNoiseBurst(durationSec);
      if (!noise) return;
      const now = this.ctx.currentTime;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(cutoffHz, now);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.exponentialRampToValueAtTime(0.006, now + durationSec);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);
      noise.stop(now + durationSec);
    } catch {}
  }

  playItemPickup() {
    if (!this.enabled) return;
    try {
      const notes = [587.33, 783.99, 987.77, 1174.66];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playToneStep(freq, 'triangle', 0.11, 0.11);
        }, idx * 42);
      });
    } catch {}
  }

  playItemEmpty() {
    if (!this.enabled) return;
    try {
      this.playToneStep(195, 'sine', 0.06, 0.06);
      setTimeout(() => {
        this.playToneStep(162, 'sine', 0.07, 0.055);
      }, 55);
    } catch {}
  }

  playNitroActivate() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.24);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);

      this.playFilteredNoise(0.22, 'bandpass', 1450, 0.085);
    } catch {}
  }

  playNitroTrail() {
    if (!this.enabled) return;
    this.playFilteredNoise(0.11, 'bandpass', 1750, 0.036);
  }

  playSnowballLaunch() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(275, now + 0.14);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);

      this.playFilteredNoise(0.1, 'highpass', 1800, 0.06);
    } catch {}
  }

  playSnowballHit() {
    if (!this.enabled) return;
    try {
      this.playFilteredNoise(0.16, 'lowpass', 720, 0.13);
      this.playToneStep(320, 'triangle', 0.12, 0.1);
      setTimeout(() => {
        this.playToneStep(210, 'sine', 0.14, 0.09);
      }, 45);
    } catch {}
  }

  playSnowballMiss() {
    if (!this.enabled) return;
    this.playFilteredNoise(0.08, 'bandpass', 1300, 0.04);
  }

  playTrapPlace() {
    if (!this.enabled) return;
    try {
      this.playToneStep(420, 'sine', 0.08, 0.085);
      setTimeout(() => {
        this.playToneStep(310, 'triangle', 0.09, 0.08);
      }, 48);
    } catch {}
  }

  playTrapHit() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.exponentialRampToValueAtTime(205, now + 0.24);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);

      this.playFilteredNoise(0.12, 'bandpass', 950, 0.075);
    } catch {}
  }

  playShieldActivate() {
    if (!this.enabled) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playToneStep(freq, 'sine', 0.16, 0.085);
        }, idx * 45);
      });
    } catch {}
  }

  playShieldBreak() {
    if (!this.enabled) return;
    try {
      this.playFilteredNoise(0.18, 'highpass', 1650, 0.12);
      this.playToneStep(880, 'triangle', 0.1, 0.1);
      setTimeout(() => {
        this.playToneStep(493.88, 'sawtooth', 0.14, 0.08);
      }, 50);
    } catch {}
  }
}

export const sounds = new SoundManager();
