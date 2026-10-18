import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { ApiError, ApiService, type VoiceReply } from '../../core/api/api.service';
import { blobToBase64 } from '../../core/audio/wav';
import { SpeechService } from '../../core/audio/speech';
import { MAX_RECORD_S, VoiceRecordError, VoiceRecorder } from '../../core/audio/voice-recorder';
import { I18nService } from '../../core/i18n/i18n.service';

type Phase = 'idle' | 'recording' | 'sending' | 'answered';
export type VoiceErrorKey = 'unsupported' | 'denied' | 'tooShort' | 'unreadable' | 'network' | 'unavailable' | 'failed';

/** 打字问题的最大长度（后端也是 300） */
export const MAX_QUESTION = 300;

export function voiceErrorKey(err: unknown): VoiceErrorKey {
  if (err instanceof VoiceRecordError) return err.key;
  const code = err instanceof ApiError ? err.code : '';
  if (code === 'network') return 'network';
  if (code === 'voice_unavailable' || code === 'not_configured') return 'unavailable';
  if (code === 'audio_too_short') return 'tooShort';
  if (code === 'unsupported_audio' || code === 'invalid_audio' || code === 'audio_too_long') return 'unreadable';
  return 'failed';
}

// 结果页的「Tanya KebunSah」：打字或说话都行，问一句关于这块地、EUDR 规定或需要的文件的话。
// Gemini 只回答这个范围里的问题，范围外的（闲聊、写代码、政治、价格……）一律得到固定的拒绝语（后端换的，不是模型写的）。
// 说话：点一下开始录、再点一下停，最长 MAX_RECORD_S 秒自动停，麦克风只在点了之后才请求权限；回答由手机念出来。
@Component({
  selector: 'app-voice-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="voice" aria-labelledby="voice-title">
      <h2 id="voice-title" class="section-title">
        <span class="ic ic-note" aria-hidden="true"></span> {{ t().voice.title }}
      </h2>
      <p class="hint voice__hint">{{ t().voice.hint }}</p>

      <form class="ask" (submit)="sendText($event)">
        <label for="question" class="sr-only">{{ t().voice.textLabel }}</label>
        <input
          id="question"
          class="field field--text"
          type="text"
          enterkeyhint="send"
          autocomplete="off"
          [maxLength]="maxQuestion"
          [placeholder]="t().voice.textPlaceholder"
          [value]="question()"
          [disabled]="phase() === 'recording' || phase() === 'sending'"
          (input)="question.set($any($event.target).value)"
        />
        <button type="submit" class="btn" id="send" [disabled]="!canSend()">
          {{ t().voice.send }}
        </button>
      </form>
      <p class="hint voice__scope">{{ t().voice.scope }}</p>

      <p class="voice__or" aria-hidden="true"><span>{{ t().voice.or }}</span></p>

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
        <div id="voice-answer" class="voice__answer" [class.voice__answer--off]="r.inScope === false">
          @if (r.transcript) {
            <p class="voice__said">
              {{ lastKind() === 'text' ? t().voice.youTyped : t().voice.youSaid }}: “{{ r.transcript }}”
            </p>
          }
          <h3 class="voice__title">{{ r.inScope === false ? t().voice.outOfScope : t().voice.answerTitle }}</h3>
          <p id="voice-text" class="voice__text">{{ r.answer }}</p>
          @if (canSpeak && r.inScope !== false) {
            <button type="button" class="btn btn-quiet" id="listen" (click)="listen()">
              <span class="ic ic-speaker" aria-hidden="true"></span>
              {{ speaking() ? t().voice.stopListening : t().voice.listen }}
            </button>
          }
          @if (r.inScope !== false) {
            <p class="hint">{{ t().voice.note }}</p>
          }
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
  protected readonly maxQuestion = MAX_QUESTION;

  protected readonly phase = signal<Phase>('idle');
  protected readonly elapsed = signal(0);
  protected readonly error = signal<VoiceErrorKey | null>(null);
  protected readonly reply = signal<VoiceReply | null>(null);
  protected readonly question = signal('');
  /** 这个回答是打字问的还是说话问的（决定显示「Soalan anda」还是「Anda kata」） */
  protected readonly lastKind = signal<'text' | 'voice'>('voice');
  protected readonly speaking = this.speech.speaking;
  protected readonly canSpeak = this.speech.supported;
  protected readonly canSend = computed(
    () => this.question().trim().length > 0 && this.phase() !== 'recording' && this.phase() !== 'sending',
  );

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.clearTimer();
      this.recorder.cancel(); // 离开页面时放掉麦克风、停掉朗读
      this.speech.cancel();
    });
  }

  // ---- 打字 ----

  /** 回车或点「Hantar」：把这句话发给后端 */
  protected async sendText(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSend()) return;
    const text = this.question().trim().slice(0, MAX_QUESTION);
    this.error.set(null);
    this.speech.cancel();
    this.phase.set('sending');
    const lang = this.i18n.lang();
    try {
      const answer = await this.api.askText(this.plotId(), { text, lang });
      this.show(answer, 'text', lang);
      this.question.set('');
    } catch (err) {
      this.error.set(voiceErrorKey(err));
      this.phase.set(this.reply() ? 'answered' : 'idle');
    }
  }

  // ---- 说话 ----

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
      this.show(answer, 'voice', lang);
    } catch (err) {
      this.error.set(voiceErrorKey(err));
      this.phase.set(this.reply() ? 'answered' : 'idle');
    }
  }

  /** 显示回答；在范围内的才念出来（范围外只是一句拒绝语，不必念） */
  private show(answer: VoiceReply, kind: 'text' | 'voice', lang: 'ms' | 'en'): void {
    this.reply.set(answer);
    this.lastKind.set(kind);
    this.phase.set('answered');
    if (answer.inScope !== false) this.speech.speak(answer.answer, lang);
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
