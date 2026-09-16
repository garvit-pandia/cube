/**
 * One-click clip capture: records the app's own canvas via
 * `canvas.captureStream(60)` plus the SoundRig audio track, then hands the
 * blob to App for download. Browser-only and best-effort — every failure
 * path returns false / no-ops so capture can never break a solve.
 */
export class CaptureManager {
  onSaved: ((blob: Blob, extension: string) => void) | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private capTimer: number | null = null;
  private live = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly audioTrack: MediaStreamTrack | null;

  /** Hard recording cap: 60 s, then auto-stop. */
  private static readonly MAX_SECONDS = 60;
  private static readonly BITS_PER_SECOND = 8_000_000;

  /** Feature-detect: hidden entirely when unsupported. */
  static supported(): boolean {
    try {
      if (typeof MediaRecorder === 'undefined') return false;
      const canvas = document.createElement('canvas');
      return typeof canvas.captureStream === 'function';
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, audioTrack: MediaStreamTrack | null) {
    this.canvas = canvas;
    this.audioTrack = audioTrack;
  }

  get recording(): boolean {
    return this.live;
  }

  /** Returns false when unsupported or negotiation fails. */
  start(): boolean {
    if (this.live) return true;
    try {
      const stream = this.canvas.captureStream(60);
      // The track set is fixed at start: toggling the sound setting
      // mid-recording cannot join this live stream. Acceptable.
      if (this.audioTrack && this.audioTrack.readyState === 'live') {
        stream.addTrack(this.audioTrack);
      }
      const choice = CaptureManager.pickType();
      if (!choice) return false;
      const recorder = new MediaRecorder(stream, {
        mimeType: choice.mime,
        videoBitsPerSecond: CaptureManager.BITS_PER_SECOND,
      });
      this.chunks = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = () => this.finish(choice.extension);
      recorder.start(250);
      this.recorder = recorder;
      this.live = true;
      this.capTimer = window.setTimeout(() => this.stop(), CaptureManager.MAX_SECONDS * 1000);
      return true;
    } catch {
      this.recorder = null;
      this.live = false;
      return false;
    }
  }

  stop(): void {
    if (!this.live) return;
    this.live = false;
    if (this.capTimer !== null) {
      window.clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    try {
      const recorder = this.recorder;
      this.recorder = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else this.chunks = [];
    } catch {
      this.chunks = [];
    }
  }

  private finish(extension: string): void {
    try {
      if (this.chunks.length === 0) return;
      const blob = new Blob(this.chunks, { type: CaptureManager.pickType()?.mime ?? 'video/webm' });
      this.onSaved?.(blob, extension);
    } catch {
      // Best-effort: a failed mux must never surface into the solve path.
    } finally {
      this.chunks = [];
    }
  }

  private static pickType(): { mime: string; extension: string } | null {
    const candidates: { mime: string; extension: string }[] = [
      { mime: 'video/webm;codecs=vp9', extension: 'webm' },
      { mime: 'video/webm;codecs=vp8', extension: 'webm' },
      { mime: 'video/webm', extension: 'webm' },
      { mime: 'video/mp4', extension: 'mp4' },
    ];
    try {
      for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
      }
    } catch {
      return null;
    }
    return null;
  }

  dispose(): void {
    try {
      this.stop();
    } catch {
      // Best-effort teardown.
    }
    this.onSaved = null;
  }
}
