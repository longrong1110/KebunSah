import { Injectable } from '@angular/core';
import { TARGET_RATE, encodeWav, peak, toMono } from './wav';

/** 录音失败的几种原因；界面按键写人话 */
export type VoiceRecordErrorKey = 'unsupported' | 'denied' | 'tooShort' | 'unreadable';

export class VoiceRecordError extends Error {
  constructor(readonly key: VoiceRecordErrorKey) {
    super(key);
    this.name = 'VoiceRecordError';
  }
}

/** 录音最长多少秒（后端上限约 45 秒；问一句话用不着那么长） */
export const MAX_RECORD_S = 20;
/** 少于这么多秒（或几乎没有声音）当作没录上 */
const MIN_SECONDS = 0.6;
const SILENCE_PEAK = 0.01;

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

// 手机麦克风录音：MediaRecorder 录下来（各浏览器格式不一样），停下后用 Web Audio 解码、降成 16 kHz 单声道 WAV。
// 麦克风只在点「说话」之后才请求权限；停止、取消、出错时一定释放麦克风（地址栏的录音图标要熄掉）。
@Injectable({ providedIn: 'root' })
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  async start(): Promise<void> {
    if (!this.supported) throw new VoiceRecordError('unsupported');
    this.cancel();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new VoiceRecordError('denied');
    }
    const type = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /** 停止并返回 16 kHz 单声道 WAV；太短或没有声音抛 tooShort，解码不了抛 unreadable */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new VoiceRecordError('unreadable'));
    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const raw = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.release();
        this.toWav(raw).then(resolve, reject);
      };
      try {
        recorder.stop();
      } catch {
        this.release();
        reject(new VoiceRecordError('unreadable'));
      }
    });
  }

  /** 放弃这次录音（离开页面、重新开始） */
  cancel(): void {
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // 已经停了
      }
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  private async toWav(raw: Blob): Promise<Blob> {
    const Ctx =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || raw.size === 0) throw new VoiceRecordError('unreadable');
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData(await raw.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
        decoded.getChannelData(i),
      );
      const mono = toMono(channels, decoded.sampleRate, TARGET_RATE);
      if (mono.length < TARGET_RATE * MIN_SECONDS || peak(mono) < SILENCE_PEAK) {
        throw new VoiceRecordError('tooShort');
      }
      return encodeWav(mono, TARGET_RATE);
    } catch (err) {
      throw err instanceof VoiceRecordError ? err : new VoiceRecordError('unreadable');
    } finally {
      void ctx.close?.();
    }
  }
}
