// 卡片上的数字与日期怎么写：面积（2.1 ha）、日期（5 Okt）、姓名（词首大写）。纯函数，随语言切换。
import type { Lang } from './i18n/i18n.service';
import { ms } from './i18n/dict.ms';
import { en } from './i18n/dict.en';

const MONTHS: Record<Lang, readonly string[]> = { ms: ms.months, en: en.months };

// 马来西亚全国都是 UTC+8，没有夏令时：直接加 8 小时再用 UTC 的取值，不依赖设备所在时区
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 面积：取 areaHaComputed，为空（point 地块）取 areaHaDeclared，都空返回 null。
 * 最多 2 位小数、去掉尾零、小数点固定用「.」：4.2300 → "4.23"，2.1 → "2.1"，3 → "3"。
 */
export function formatArea(computed: unknown, declared: unknown): string | null {
  const ha = [computed, declared].find((v): v is number => typeof v === 'number' && v > 0);
  if (ha === undefined) return null;
  const rounded = Math.round(ha * 100) / 100;
  // 小到四舍五入成 0 的面积不显示成「0 ha」，当作没填
  return rounded > 0 ? String(rounded) : null;
}

/** 日期写成「5 Okt」：日不补零，月份缩写按语言。空或无效返回 null（调用方整段省略）。 */
export function formatDay(value: unknown, lang: Lang): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const local = new Date(value.getTime() + MALAYSIA_OFFSET_MS);
  return `${local.getUTCDate()} ${MONTHS[lang][local.getUTCMonth()]}`;
}

// 马来语姓名里的连接词不大写：AHMAD ZAKI BIN ROSLI → Ahmad Zaki bin Rosli
const LOWER_WORDS = new Set(['bin', 'binti', 'a/l', 'a/p']);

export function titleCaseName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const w = word.toLowerCase();
      return LOWER_WORDS.has(w)
        ? w
        : w.replace(/(^|[^a-z])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
    })
    .join(' ');
}

/**
 * 「2026-04-30」或以它开头的字符串（如后端写的「2026-04-30 已过期」）→「30 Apr 2026」，月份缩写按语言。
 * 不是合法日期（月份、日数不对、2 月 30 日）返回 null，调用方改用不带日期的句子。
 */
export function formatIsoDay(value: unknown, lang: Lang): string | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid =
    month >= 1 &&
    month <= 12 &&
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return valid ? `${day} ${MONTHS[lang][month - 1]} ${year}` : null;
}
