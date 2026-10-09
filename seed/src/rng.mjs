// 确定性随机数：同一种子永远产生同一串数，输出才能逐字节重现。

// FNV-1a，把任意字符串压成 32 位种子，用来给每个地块"分叉"出独立的随机流。
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32：够用、很快、没有外部依赖。
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // items: [[值, 权重], …]
    weighted(items) {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [value, w] of items) {
        x -= w;
        if (x < 0) return value;
      }
      return items[items.length - 1][0];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    digits: (n) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
    hex: (n) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join(''),
    // v4 形状的 UUID：版本位 4、变体位 8，跟 schema.sql 里的演示 id 同一种写法
    uuid() {
      return `${rng.hex(8)}-${rng.hex(4)}-4${rng.hex(3)}-8${rng.hex(3)}-${rng.hex(12)}`;
    },
    // 按标签分叉：改动某个地块的造法不会打乱其它地块
    fork: (label) => createRng(hashString(`${seed}:${label}`)),
  };
  return rng;
}
