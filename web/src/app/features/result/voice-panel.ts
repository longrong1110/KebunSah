import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { ApiError, ApiService, type VoiceReply } from '../../core/api/api.service';
import { blobToBase64 } from '../../core/audio/wav';
import { SpeechService } from '../../core/audio/speech';
import { MAX_RECORD_S, VoiceRecordError, VoiceRecorder } from '../../core/audio/voice-recorder';
import { I18nService } from '../../core/i18n/i18n.service';

type Phase = 'idle' | 'recording' | 'sending' | 'answered';
export type VoiceErrorKey = 'unsupported' | 'denied' | 'tooShort' | 'unreadable' | 'network' | 'unavailable' | 'failed';

export function voiceErrorKey(err: unknown): VoiceErrorKey {
  if (err instanceof VoiceRecordError) return err.key;
  const code = err instanceof ApiError ? err.code : '';
  if (code === 'network') return 'network';
  if (code === 'voice_unavailable' || code === 'not_configured') return 'unavailable';
  if (code === 'audio_too_short') return 'tooShort';
  if (code === 'unsupported_audio' || code === 'invalid_audio' || code === 'audio_too_long') return 'unreadable';
  return 'failed';
}

// 结果页的「Tanya dengan suara」：园主对着手机问一句（马来语或英语），Gemini 直接听音频，
// 只按这块地的检查结果回答，回答由手机念出来。读字吃力的年长园主也能用。
// 点一下开始录、再点一下停；最长 MAX_RECORD_S 秒自动停。麦克风只在点了之后才请求权限。
@Component({
  selector: 'app-voice-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="voice" aria-labelledby="voice-title">
      <h2 id="voice-title" class="section-title">
        <span class="ic ic-mic" aria-hidden="true"></span> {{ t().voice.title }}
      </h2>
      <p class="hint voice__hint">{{ t().voice.hint }}</p>

      <button
        type="button"
        id="mic"
        class="mic"
        [class.mic--on]="phase() === 'recording'"
        [disabled]="phase() === 'sending'"
        [attr.aria-pressed]="phase() === 'recording'"
        (click)="toggle()"
      >
        <span
          class="ic ic--lg"
          [class.ic-mic]="phase() !== 'recording'"
          [class.ic-stop]="phase() === 'recording'"
          aria-hidden="true"
        ></span>
        <span class="mic__label">
          @switch (phase()) {
            @case ('recording') {
              {{ t().voice.stop }}
            }
            @case ('answered') {
              {{ t().voice.again }}
            }
            @default {
              {{ t().voice.start }}
            }
          }
        </span>
      </button>

      <p id="voice-status" class="voice__status" role="status" aria-live="polite">
        @if (phase() === 'recording') {
          {{ t().voice.recording(elapsed()) }}
        } @else if (phase() === 'sending') {
          {{ t().voice.sending }}
        }
      </p>

      @if (error(); as e) {
        <p id="voice-error" class="error" role="alert">
          <span class="ic ic-alert" aria-hidden="true"></span> {{ t().voice.errors[e] }}
        </p>
      }

      @if (reply(); as r) {
        <div id="voice-answer" class="voice__answer">
          @if (r.transcript) {
            <p class="voice__said">{{ t().voice.youSaid }}: “{{ r.transcript }}”</p>
          }
          <h3 class="voice__title">{{ t().voice.answerTitle }}</h3>
          <p id="voice-text" class="voice__text">{{ r.answer }}</p>
          @if (canSpeak) {
            <button type="button" class="btn btn-quiet" id="listen" (click)="listen()">
              <span class="ic ic-speaker" aria-hidden="true"></span>
              {{ speaking() ? t().voice.stopListening : t().voice.listen }}
            </button>
          }
          <p class="hint">{{ t().voice.note }}</p>
        </div>
      }
    </section>
  `,
})
export class VoicePanel {
  readonly plotId = input.required<string>();

  private readonly recorder = inject(VoiceRecorder);
  private readonly api = inject(ApiService);
  private readonly speech = inject(SpeechService);
  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  protected readonly phase = signal<Phase>('idle');
  protected readonly elapsed = signal(0);
  protected readonly error = signal<VoiceErrorKey | null>(null);
  protected readonly reply = signal<VoiceReply | null>(null);
  protected readonly speaking = this.speech.speaking;
  protected readonly canSpeak = this.speech.supported;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.clearTimer();
      this.recorder.cancel(); // 离开页面时放掉麦克风、停掉朗读
      this.speech.cancel();
    });
  }

  protected toggle(): void {
    const phase = this.phase();
    if (phase === 'recording') void this.finish();
    else if (phase !== 'sending') void this.begin();
  }

  private async begin(): Promise<void> {
    this.error.set(null);
    this.speech.cancel();
    try {
      await this.recorder.start();
    } catch (err) {
      this.error.set(voiceErrorKey(err));
      return;
    }
    this.phase.set('recording');
    this.elapsed.set(0);
    this.timer = setInterval(() => {
      this.elapsed.update((s) => s + 1);
      if (this.elapsed() >= MAX_RECORD_S) void this.finish();
    }, 1000);
  }

  /** 停止录音 → 转 WAV → 问后端 → 显示并念出回答 */
  private async finish(): Promise<void> {
    if (this.phase() !== 'recording') return;
    this.clearTimer();
    this.phase.set('sending');
    const lang = this.i18n.lang();
    try {
      const wav = await this.recorder.stop();
      const answer = await this.api.askVoice(this.plotId(), {
        audio: await blobToBase64(wav),
        mimeType: 'audio/wav',
        lang,
      });
      this.reply.set(answer);
      this.phase.set('answered');
      this.speech.speak(answer.answer, lang);
    } catch (err) {
      this.error.set(voiceErrorKey(err));
      this.phase.set(this.reply() ? 'answered' : 'idle');
    }
  }

  protected listen(): void {
    const r = this.reply();
    if (!r) return;
    if (this.speaking()) this.speech.cancel();
    else this.speech.speak(r.answer, this.i18n.lang());
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
