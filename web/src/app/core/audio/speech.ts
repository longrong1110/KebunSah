import { Injectable, signal } from '@angular/core';

export type SpeechLang = 'ms' | 'en';

/** 每种语言按这个顺序找声音：马来语手机常常没有，印尼语的声音听起来很接近，比用英语念马来文好 */
const PREFERRED: Record<SpeechLang, string[]> = {
  ms: ['ms-MY', 'ms', 'id-ID', 'id'],
  en: ['en-MY', 'en-GB', 'en-US', 'en'],
};

/** 从设备上的声音里挑一个；都没有就返回 null（交给浏览器按 lang 自己选） */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: SpeechLang,
): SpeechSynthesisVoice | null {
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
  for (const wanted of PREFERRED[lang]) {
    const w = wanted.toLowerCase();
    const hit = voices.find((v) => norm(v) === w) ?? voices.find((v) => norm(v).startsWith(w + '-'));
    if (hit) return hit;
  }
  return null;
}

// 把回答念出来。年长的园主读字吃力，听比读容易；用设备自带的朗读（不用联网，不额外花钱）。
@Injectable({ providedIn: 'root' })
export class SpeechService {
  readonly speaking = signal(false);

  get supported(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  speak(text: string, lang: SpeechLang): void {
    if (!this.supported || !text.trim()) return;
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(speechSynthesis.getVoices(), lang);
    utterance.lang = voice?.lang ?? (lang === 'ms' ? 'ms-MY' : 'en-GB');
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95; // 比平时慢一点点，听得清楚
    utterance.onend = () => this.speaking.set(false);
    utterance.onerror = () => this.speaking.set(false);
    this.speaking.set(true);
    speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.supported) speechSynthesis.cancel();
    this.speaking.set(false);
  }
}
