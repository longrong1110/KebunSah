// 语音问答要把手机录到的声音（webm／mp4，48 kHz 双声道）变成后端和 Gemini 都认的格式：16 kHz 单声道 16 位 WAV。
// 16 kHz 对人声足够，一秒只有 32 KB（20 秒不到 700 KB）。这里是纯函数，不碰浏览器 API，方便测试。

export const TARGET_RATE = 16_000;

/** 多声道混成单声道，再降到 outRate。每个输出样本取对应输入区间的平均值（兼作简单的抗混叠）。 */
export function toMono(
  channels: readonly Float32Array[],
  inRate: number,
  outRate = TARGET_RATE,
): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || inRate <= 0 || outRate <= 0) return new Float32Array(0);
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  if (inRate === outRate) return mono;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += mono[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** 最大振幅（0–1）：几乎是 0 说明什么声音都没录到 */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  return max;
}

/** 16 位 PCM 的 WAV 文件：44 字节头 + 数据 */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Blob {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 每秒字节数
  view.setUint16(32, 2, true); // 每个采样帧的字节数
  view.setUint16(34, 16, true); // 位深
  text(36, 'data');
  view.setUint32(40, bytes, true);
  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Blob → base64（不带 data: 前缀） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
