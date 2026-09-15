/**
 * Synthesized cube sounds. Render-layer, best-effort: every public method
 * swallows failures so audio can never break a solve. The AudioContext is
 * created lazily on the first user gesture (`unlock`) because browsers refuse
 * to start audio any earlier.
 */
const CHIME_FREQS = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

const SILENCE = 0.0001; // exponential ramps cannot reach literal 0

export class SoundRig {
  private readonly isEnabled: () => boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private dead = false;

  constructor(isEnabled: () => boolean) {
    this.isEnabled = isEnabled;
  }

  /**
   * Lazily create the AudioContext. Safe to call repeatedly and from any
   * gesture handler. If construction throws, the rig stays dead and every
   * method no-ops forever.
   */
  unlock(): void {
    if (this.dead) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return;
    }
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      // Kept for the clip recorder: the same audio can be muxed into a capture.
      this.streamDest = ctx.createMediaStreamDestination();
      master.connect(this.streamDest);
      this.ctx = ctx;
      this.master = master;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    } catch {
      this.dead = true;
      this.ctx = null;
      this.master = null;
      this.streamDest = null;
    }
  }

  /** Context that is safe to synthesize into, or null when silent. */
  private ready(): AudioContext | null {
    if (this.dead || !this.isEnabled()) return null;
    const ctx = this.ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      // Try to recover, but skip this onset rather than queue it up late.
      void ctx.resume().catch(() => {});
      return null;
    }
    return ctx;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Short mechanical turn click. intensity 0..1 (default 0.6). */
  click(intensity = 0.6): void {
    const ctx = this.ready();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const level = Math.min(Math.max(intensity, 0), 1) * (0.85 + Math.random() * 0.3);
      const now = ctx.currentTime;

      // Noise transient: the plastic "tick" of a layer snapping into place.
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer(ctx, 0.008);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const center = (1800 + Math.random() * 800) * (0.9 + Math.random() * 0.2);
      filter.frequency.setValueAtTime(center, now);
      filter.Q.setValueAtTime(1.2, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(Math.max(SILENCE, 0.5 * level), now);
      noiseGain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.009);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + 0.02);

      // Low thump: gives the click some body without a broadband snap.
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(140, now);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(Math.max(SILENCE, 0.35 * level), now);
      thumpGain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.055);
      thump.connect(thumpGain);
      thumpGain.connect(master);
      thump.start(now);
      thump.stop(now + 0.06);
    } catch {
      // Best-effort: a failed sound must never disturb the solve.
    }
  }

  /** ~300 ms filtered-noise sweep for scramble starts. */
  whoosh(): void {
    const ctx = this.ready();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const now = ctx.currentTime;
      const duration = 0.3;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx, duration);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(0.9, now);
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(2200, now + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(SILENCE, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(SILENCE, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.stop(now + duration);
    } catch {
      // Best-effort.
    }
  }

  /** Solve finale: stacked detuned sines, slow exponential decay. */
  chime(): void {
    const ctx = this.ready();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const now = ctx.currentTime;
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0.9, now);
      bus.connect(master);
      CHIME_FREQS.forEach((freq, index) => {
        const start = now + index * 0.03;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.detune.setValueAtTime((Math.random() * 2 - 1) * 4, start);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(SILENCE, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(SILENCE, start + 1.2);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(start);
        osc.stop(start + 1.25);
      });
    } catch {
      // Best-effort.
    }
  }

  /** Audio track for the clip recorder; null until unlock() succeeds. */
  get audioTrack(): MediaStreamTrack | null {
    return this.streamDest?.stream.getAudioTracks()[0] ?? null;
  }

  /** Close the context and drop every node. The rig is dead afterwards. */
  dispose(): void {
    this.dead = true;
    try {
      this.master?.disconnect();
      void this.ctx?.close().catch(() => {});
    } catch {
      // Best-effort.
    }
    this.ctx = null;
    this.master = null;
    this.streamDest = null;
  }
}
