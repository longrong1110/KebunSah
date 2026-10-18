import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechService, pickVoice } from './speech';
import { VoiceRecordError, VoiceRecorder } from './voice-recorder';
import { blobToBase64, encodeWav, peak, toMono } from './wav';

const bytesOf = async (blob: Blob) => new DataView(await blob.arrayBuffer());
const ascii = (v: DataView, at: number, n: number) =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

describe('wav：转成后端认的格式', () => {
  it('toMono：双声道取平均；48 kHz 降到 16 kHz 每三个样本取一个平均值', () => {
    const left = Float32Array.from([1, 1, 1, 0, 0, 0]);
    const right = Float32Array.from([0, 0, 0, 0, 0, 0]);
    expect(Array.from(toMono([left, right], 16_000, 16_000))).toEqual([0.5, 0.5, 0.5, 0, 0, 0]);
    const down = toMono([Float32Array.from([1, 1, 1, 0, 0, 0])], 48_000, 16_000);
    expect(Array.from(down)).toEqual([1, 0]);
  });

  it('toMono：没有数据返回空，不抛', () => {
    expect(toMono([], 48_000).length).toBe(0);
    expect(toMono([new Float32Array(0)], 48_000).length).toBe(0);
  });

  it('peak：最大振幅（绝对值）', () => {
    expect(peak(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
    expect(peak(new Float32Array(10))).toBe(0);
  });

  it('encodeWav：44 字节头 + 16 位 PCM，单声道，采样率写对，超出范围的样本截断', async () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2, -2]), 16_000);
    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(44 + 5 * 2);
    const v = await bytesOf(wav);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 10);
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // 单声道
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(32_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768]);
  });

  it('blobToBase64：不带前缀，能还原；大文件也不爆栈', async () => {
    expect(await blobToBase64(new Blob(['hello']))).toBe(btoa('hello'));
    const big = new Uint8Array(200_000).fill(65);
    const b64 = await blobToBase64(new Blob([big]));
    expect(atob(b64).length).toBe(200_000);
  });
});

describe('speech：把回答念出来', () => {
  afterEach(() => vi.unstubAllGlobals());

  const voice = (lang: string, name = lang) => ({ lang, name }) as SpeechSynthesisVoice;

  it('pickVoice：马来语优先 ms-MY，其次 ms，再退到印尼语；英语优先 en-MY；没有就 null', () => {
    expect(pickVoice([voice('en-US'), voice('id-ID'), voice('ms-MY')], 'ms')?.lang).toBe('ms-MY');
    expect(pickVoice([voice('id-ID'), voice('en-US')], 'ms')?.lang).toBe('id-ID');
    expect(pickVoice([voice('ms_MY')], 'ms')?.lang).toBe('ms_MY'); // Android 用下划线
    expect(pickVoice([voice('en-GB'), voice('en-MY')], 'en')?.lang).toBe('en-MY');
    expect(pickVoice([voice('fr-FR')], 'ms')).toBeNull();
  });

  function stubSpeech(voices: SpeechSynthesisVoice[]) {
    const spoken: { text: string; lang: string; voice: unknown }[] = [];
    let last: { onend?: () => void } | null = null;
    class Utter {
      lang = '';
      voice: unknown = null;
      rate = 1;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    }
    const synth = {
      getVoices: () => voices,
      speak: vi.fn((u: Utter) => {
        spoken.push({ text: u.text, lang: u.lang, voice: u.voice });
        last = u;
      }),
      cancel: vi.fn(),
    };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', Utter);
    return { synth, spoken, end: () => last?.onend?.() };
  }

  it('speak：用挑出来的声音和语言；念的时候 speaking 为 true，念完变回 false', () => {
    const s = stubSpeech([voice('id-ID')]);
    const speech = TestBed.inject(SpeechService);
    expect(speech.supported).toBe(true);
    speech.speak('Tanah anda lengkap.', 'ms');
    expect(s.spoken).toEqual([{ text: 'Tanah anda lengkap.', lang: 'id-ID', voice: expect.anything() }]);
    expect(speech.speaking()).toBe(true);
    s.end();
    expect(speech.speaking()).toBe(false);
  });

  it('speak：没有合适的声音也照念（交给浏览器按语言选）；空文字不念', () => {
    const s = stubSpeech([]);
    const speech = TestBed.inject(SpeechService);
    speech.speak('  ', 'ms');
    expect(s.synth.speak).not.toHaveBeenCalled();
    speech.speak('Hello', 'en');
    expect(s.spoken[0].lang).toBe('en-GB');
  });

  it('cancel：停止朗读；设备不支持时什么都不做也不报错', () => {
    const s = stubSpeech([]);
    const speech = TestBed.inject(SpeechService);
    speech.speak('Hello', 'en');
    speech.cancel();
    expect(s.synth.cancel).toHaveBeenCalled();
    expect(speech.speaking()).toBe(false);

    vi.unstubAllGlobals();
    expect(() => speech.speak('x', 'ms')).not.toThrow();
    expect(speech.supported).toBe(false);
  });
});

describe('VoiceRecorder：麦克风录音', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  });

  function stubDevice(opts: { samples?: Float32Array; rate?: number; denied?: boolean; decodeFails?: boolean } = {}) {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => {
      if (opts.denied) throw new DOMException('no', 'NotAllowedError');
      return stream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    class FakeRecorder {
      static isTypeSupported = (t: string) => t === 'audio/webm';
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
        this.ondataavailable?.({ data: new Blob(['abc']) });
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    class FakeContext {
      decodeAudioData = vi.fn(async () => {
        if (opts.decodeFails) throw new Error('bad data');
        const data = opts.samples ?? new Float32Array(48_000).fill(0.2);
        return { numberOfChannels: 1, sampleRate: opts.rate ?? 48_000, getChannelData: () => data };
      });
      close = vi.fn();
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('AudioContext', FakeContext);
    return { track, getUserMedia };
  }

  it('不支持录音的浏览器：start 抛 unsupported，不请求麦克风', async () => {
    const rec = TestBed.inject(VoiceRecorder);
    expect(rec.supported).toBe(false);
    await expect(rec.start()).rejects.toMatchObject({ key: 'unsupported' });
  });

  it('用户拒绝麦克风：抛 denied', async () => {
    stubDevice({ denied: true });
    await expect(TestBed.inject(VoiceRecorder).start()).rejects.toMatchObject({ key: 'denied' });
  });

  it('录一秒：停止后得到 16 kHz 单声道 WAV，麦克风被释放', async () => {
    const dev = stubDevice();
    const rec = TestBed.inject(VoiceRecorder);
    await rec.start();
    const wav = await rec.stop();
    expect(wav.type).toBe('audio/wav');
    const v = await bytesOf(wav);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(16_000 * 2); // 1 秒 × 16 kHz × 2 字节
    expect(dev.track.stop).toHaveBeenCalled();
  });

  it('太短或几乎没有声音：抛 tooShort', async () => {
    stubDevice({ samples: new Float32Array(4_800).fill(0.2) }); // 0.1 秒
    const rec = TestBed.inject(VoiceRecorder);
    await rec.start();
    await expect(rec.stop()).rejects.toMatchObject({ key: 'tooShort' });

    stubDevice({ samples: new Float32Array(48_000) }); // 一秒，全是静音
    await rec.start();
    await expect(rec.stop()).rejects.toBeInstanceOf(VoiceRecordError);
  });

  it('解码不了：抛 unreadable', async () => {
    stubDevice({ decodeFails: true });
    const rec = TestBed.inject(VoiceRecorder);
    await rec.start();
    await expect(rec.stop()).rejects.toMatchObject({ key: 'unreadable' });
  });

  it('cancel：放弃录音并释放麦克风；没在录时 stop 抛 unreadable', async () => {
    const dev = stubDevice();
    const rec = TestBed.inject(VoiceRecorder);
    await rec.start();
    rec.cancel();
    expect(dev.track.stop).toHaveBeenCalled();
    await expect(rec.stop()).rejects.toMatchObject({ key: 'unreadable' });
  });
});
