import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../../../testing/fake-facade';
import { ApiError, ApiService } from '../../core/api/api.service';
import { SpeechService } from '../../core/audio/speech';
import { VoiceRecordError, VoiceRecorder } from '../../core/audio/voice-recorder';
import { I18nService } from '../../core/i18n/i18n.service';
import { VoicePanel, voiceErrorKey } from './voice-panel';

const REPLY = { transcript: 'kenapa tanah saya kuning', answer: 'Keluasan tidak sepadan dengan geran.', lang: 'ms' as const };

const tick = async () => {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => setTimeout(resolve));
};

function setup(over: { start?: () => Promise<void>; stop?: () => Promise<Blob>; ask?: () => Promise<unknown>; canSpeak?: boolean } = {}) {
  const recorder = {
    start: vi.fn(over.start ?? (async () => undefined)),
    stop: vi.fn(over.stop ?? (async () => new Blob(['RIFFwav']))),
    cancel: vi.fn(),
  };
  const api = { askVoice: vi.fn(over.ask ?? (async () => REPLY)) };
  const speaking = signal(false);
  const speech = { speaking, supported: over.canSpeak ?? true, speak: vi.fn(), cancel: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: VoiceRecorder, useValue: recorder },
      { provide: ApiService, useValue: api },
      { provide: SpeechService, useValue: speech },
    ],
  });
  const fixture = TestBed.createComponent(VoicePanel);
  fixture.componentRef.setInput('plotId', 'p1');
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    recorder,
    api,
    speech,
    speaking,
    i18n: TestBed.inject(I18nService),
    q: (sel: string) => el.querySelector<HTMLElement>(sel),
    text: (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    click: async (sel: string) => {
      el.querySelector<HTMLElement>(sel)!.click();
      // 录音、转 base64、请求都是 Promise 链：让出几个宏任务，等它们跑完再刷新界面
      for (let i = 0; i < 4; i++) await tick();
      await settle(fixture);
    },
  };
}

describe('VoicePanel：用声音问', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('一开始：说明和「Tekan untuk bercakap」，不请求麦克风', async () => {
    const t = setup();
    await settle(t.fixture);
    expect(t.text('#voice-title')).toContain('Tanya dengan suara');
    expect(t.text('#mic')).toBe('Tekan untuk bercakap');
    expect(t.recorder.start).not.toHaveBeenCalled();
    expect(t.q('#voice-answer')).toBeNull();
  });

  it('点一下开始录：按钮变成停止，状态区报秒数（读屏会念）', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.click('#mic');
    expect(t.recorder.start).toHaveBeenCalledTimes(1);
    expect(t.q('#mic')?.getAttribute('aria-pressed')).toBe('true');
    expect(t.text('#mic')).toBe('Tekan untuk berhenti');
    expect(t.q('#voice-status')?.getAttribute('aria-live')).toBe('polite');
    expect(t.text('#voice-status')).toBe('Sedang merakam… 0 saat');
    await vi.advanceTimersByTimeAsync(3000);
    await settle(t.fixture);
    expect(t.text('#voice-status')).toBe('Sedang merakam… 3 saat');
  });

  it('再点一下：发给后端（WAV 的 base64、当前语言），显示听到的和回答，并念出来', async () => {
    const t = setup();
    await t.click('#mic');
    await t.click('#mic');
    expect(t.api.askVoice).toHaveBeenCalledWith('p1', {
      audio: btoa('RIFFwav'),
      mimeType: 'audio/wav',
      lang: 'ms',
    });
    expect(t.text('.voice__said')).toContain('kenapa tanah saya kuning');
    expect(t.text('#voice-text')).toBe('Keluasan tidak sepadan dengan geran.');
    expect(t.speech.speak).toHaveBeenCalledWith('Keluasan tidak sepadan dengan geran.', 'ms');
    expect(t.text('#mic')).toBe('Tanya lagi');
    expect(t.text('.hint:last-child')).toContain('sekadar panduan');
  });

  it('英语界面：用英语问、用英语念', async () => {
    const t = setup({ ask: async () => ({ ...REPLY, lang: 'en' }) });
    t.i18n.set('en');
    await settle(t.fixture);
    expect(t.text('#mic')).toBe('Tap to speak');
    await t.click('#mic');
    await t.click('#mic');
    expect(t.api.askVoice).toHaveBeenCalledWith('p1', expect.objectContaining({ lang: 'en' }));
    expect(t.speech.speak).toHaveBeenCalledWith(REPLY.answer, 'en');
  });

  it('发送中：按钮禁用，状态区说在听', async () => {
    let done!: (v: unknown) => void;
    const t = setup({ ask: () => new Promise((r) => (done = r)) });
    await t.click('#mic');
    await t.click('#mic');
    expect((t.q('#mic') as HTMLButtonElement).disabled).toBe(true);
    expect(t.text('#voice-status')).toBe('Sedang mendengar dan menjawab…');
    done(REPLY);
    await settle(t.fixture);
    expect((t.q('#mic') as HTMLButtonElement).disabled).toBe(false);
  });

  it('录满 20 秒自动停止并发送', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.click('#mic');
    await vi.advanceTimersByTimeAsync(20_000);
    await settle(t.fixture);
    expect(t.recorder.stop).toHaveBeenCalledTimes(1);
    expect(t.api.askVoice).toHaveBeenCalledTimes(1);
  });

  it('麦克风被拒：说明怎么办，停在初始状态', async () => {
    const t = setup({
      start: async () => {
        throw new VoiceRecordError('denied');
      },
    });
    await t.click('#mic');
    expect(t.text('#voice-error')).toContain('Mikrofon tidak dibenarkan');
    expect(t.text('#mic')).toBe('Tekan untuk bercakap');
    expect(t.api.askVoice).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(0, 'network'), 'Tiada sambungan'],
    [new ApiError(503, 'voice_unavailable'), 'belum tersedia'],
    [new ApiError(502, 'voice_failed'), 'Tidak dapat menjawab'],
    [new ApiError(422, 'audio_too_short'), 'Tiada suara yang cukup'],
  ])('后端失败（%s）：人话说明，可以再试', async (err, expected) => {
    const t = setup({
      ask: async () => {
        throw err;
      },
    });
    await t.click('#mic');
    await t.click('#mic');
    expect(t.text('#voice-error')).toContain(expected);
    expect(t.text('#mic')).toBe('Tekan untuk bercakap');
    expect((t.q('#mic') as HTMLButtonElement).disabled).toBe(false);
  });

  it('录音太短：不发给后端', async () => {
    const t = setup({
      stop: async () => {
        throw new VoiceRecordError('tooShort');
      },
    });
    await t.click('#mic');
    await t.click('#mic');
    expect(t.api.askVoice).not.toHaveBeenCalled();
    expect(t.text('#voice-error')).toContain('Tiada suara yang cukup');
  });

  it('「Dengar jawapan」：再念一遍；正在念时变成「Berhenti membaca」，点它就停', async () => {
    const t = setup();
    await t.click('#mic');
    await t.click('#mic');
    t.speech.speak.mockClear();
    await t.click('#listen');
    expect(t.speech.speak).toHaveBeenCalledTimes(1);
    t.speaking.set(true);
    await settle(t.fixture);
    expect(t.text('#listen')).toContain('Berhenti membaca');
    await t.click('#listen');
    expect(t.speech.cancel).toHaveBeenCalled();
  });

  it('设备不支持朗读：只显示文字，没有「Dengar」按钮', async () => {
    const t = setup({ canSpeak: false });
    await t.click('#mic');
    await t.click('#mic');
    expect(t.q('#voice-text')).not.toBeNull();
    expect(t.q('#listen')).toBeNull();
  });

  it('离开页面：放掉麦克风、停掉朗读', async () => {
    const t = setup();
    await t.click('#mic');
    t.fixture.destroy();
    expect(t.recorder.cancel).toHaveBeenCalled();
    expect(t.speech.cancel).toHaveBeenCalled();
  });
});

describe('voiceErrorKey', () => {
  it('把录音错误和接口错误归成界面用的键', () => {
    expect(voiceErrorKey(new VoiceRecordError('denied'))).toBe('denied');
    expect(voiceErrorKey(new ApiError(0, 'network'))).toBe('network');
    expect(voiceErrorKey(new ApiError(503, 'voice_unavailable'))).toBe('unavailable');
    expect(voiceErrorKey(new ApiError(0, 'not_configured'))).toBe('unavailable');
    expect(voiceErrorKey(new ApiError(413, 'audio_too_long'))).toBe('unreadable');
    expect(voiceErrorKey(new ApiError(500, 'http_error'))).toBe('failed');
    expect(voiceErrorKey(new Error('x'))).toBe('failed');
  });
});
