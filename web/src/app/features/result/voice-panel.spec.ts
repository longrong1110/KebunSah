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

function setup(
  over: {
    start?: () => Promise<void>;
    stop?: () => Promise<Blob>;
    ask?: () => Promise<unknown>;
    askText?: () => Promise<unknown>;
    canSpeak?: boolean;
  } = {},
) {
  const recorder = {
    start: vi.fn(over.start ?? (async () => undefined)),
    stop: vi.fn(over.stop ?? (async () => new Blob(['RIFFwav']))),
    cancel: vi.fn(),
  };
  const api = {
    askVoice: vi.fn(over.ask ?? (async () => REPLY)),
    askText: vi.fn(over.askText ?? (async () => REPLY)),
  };
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
    expect(t.text('#voice-title')).toContain('Tanya KebunSah');
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

describe('VoicePanel：打字提问，只限这块地、EUDR 和需要的文件', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const type = async (t: ReturnType<typeof setup>, value: string) => {
    const input = t.q('#question') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(t.fixture);
  };

  it('有输入框、范围说明和「Hantar」；一开始没有输入，发送按钮禁用', async () => {
    const t = setup();
    await settle(t.fixture);
    expect(t.q('#question')?.getAttribute('maxlength')).toBe('300');
    expect(t.text('#send')).toBe('Hantar');
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(true);
    expect(t.text('.voice__scope')).toContain('hanya menjawab soalan tentang tanah ini, EUDR dan dokumen');
    expect(t.text('#voice-title')).toContain('Tanya KebunSah');
  });

  it('只有空格也不能发送', async () => {
    const t = setup();
    await type(t, '    ');
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('打一句话发送：去掉首尾空格后发给后端，显示「Soalan anda」和回答，念出来，输入框清空', async () => {
    const t = setup({ askText: async () => ({ ...REPLY, transcript: 'Bila EUDR bermula?' }) });
    await type(t, '  Bila EUDR bermula?  ');
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(false);
    await t.click('#send');
    expect(t.api.askText).toHaveBeenCalledWith('p1', { text: 'Bila EUDR bermula?', lang: 'ms' });
    expect(t.api.askVoice).not.toHaveBeenCalled();
    expect(t.text('.voice__said')).toContain('Soalan anda');
    expect(t.text('.voice__said')).toContain('Bila EUDR bermula?');
    expect(t.text('#voice-text')).toBe('Keluasan tidak sepadan dengan geran.');
    expect(t.speech.speak).toHaveBeenCalledWith('Keluasan tidak sepadan dengan geran.', 'ms');
    expect((t.q('#question') as HTMLInputElement).value).toBe('');
  });

  it('回车也能发送（表单提交）', async () => {
    const t = setup();
    await type(t, 'Kenapa kuning?');
    (t.q('form.ask') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r));
    await settle(t.fixture);
    expect(t.api.askText).toHaveBeenCalledTimes(1);
  });

  it('英语界面：用英语问', async () => {
    const t = setup();
    t.i18n.set('en');
    await type(t, 'When does EUDR start?');
    await t.click('#send');
    expect(t.api.askText).toHaveBeenCalledWith('p1', { text: 'When does EUDR start?', lang: 'en' });
    expect(t.text('#send')).toBe('Send');
    expect(t.text('.voice__said')).toContain('Your question');
  });

  it('范围外的问题：显示固定的拒绝语，标题是「Di luar skop」，灰色样式，不念、没有「Dengar」和 AI 提示', async () => {
    const refusal = 'Maaf, saya hanya boleh menjawab soalan tentang semakan tanah ini.';
    const t = setup({ askText: async () => ({ transcript: 'tulis puisi', answer: refusal, lang: 'ms', inScope: false }) });
    await type(t, 'tulis puisi');
    await t.click('#send');
    expect(t.text('#voice-text')).toBe(refusal);
    expect(t.text('.voice__title')).toBe('Di luar skop');
    expect(t.q('#voice-answer')?.classList.contains('voice__answer--off')).toBe(true);
    expect(t.speech.speak).not.toHaveBeenCalled();
    expect(t.q('#listen')).toBeNull();
    expect(t.q('#voice-answer .hint')).toBeNull();
  });

  it('旧后端没有 inScope 字段：当成范围内', async () => {
    const t = setup({ askText: async () => ({ transcript: 'x', answer: 'jawapan', lang: 'ms' }) });
    await type(t, 'x');
    await t.click('#send');
    expect(t.text('.voice__title')).toBe('Jawapan');
    expect(t.speech.speak).toHaveBeenCalled();
  });

  it('发送中：输入框和按钮禁用；失败：人话说明，输入保留，可以再发', async () => {
    let fail!: (e: unknown) => void;
    const t = setup({ askText: () => new Promise((_, reject) => (fail = reject)) });
    await type(t, 'Kenapa kuning?');
    await t.click('#send');
    expect((t.q('#question') as HTMLInputElement).disabled).toBe(true);
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(true);
    expect(t.text('#voice-status')).toBe('Sedang mendengar dan menjawab…');
    fail(new ApiError(0, 'network'));
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r));
    await settle(t.fixture);
    expect(t.text('#voice-error')).toContain('Tiada sambungan');
    expect((t.q('#question') as HTMLInputElement).value).toBe('Kenapa kuning?');
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('后端说还没配置：说明「belum tersedia」', async () => {
    const t = setup({
      askText: async () => {
        throw new ApiError(503, 'voice_unavailable');
      },
    });
    await type(t, 'hi');
    await t.click('#send');
    expect(t.text('#voice-error')).toContain('belum tersedia');
  });

  it('录音中不能打字发送', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.click('#mic');
    expect((t.q('#question') as HTMLInputElement).disabled).toBe(true);
    expect((t.q('#send') as HTMLButtonElement).disabled).toBe(true);
  });
});
