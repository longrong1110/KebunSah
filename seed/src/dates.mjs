// 日期计算全部走 UTC 整数天，不读系统时钟、不受时区影响。
const MS_DAY = 86400000;

export function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromDayNumber(n) {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

export const addDays = (date, n) => fromDayNumber(dayNumber(date) + n);

// from → to 相隔几天（to 在后为正）
export const diffDays = (from, to) => dayNumber(to) - dayNumber(from);

export function addYears(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 马来西亚时间（UTC+8）的某日某时 → UTC 的 ISO 字符串，跟 schema.sql 里 "…+08" 的写法对应
export function myt(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h - 8, mi)).toISOString();
}

// ISO 时间戳加分钟
export const addMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();

// '2026-12-05' → '05/12/2026'，证件上常见的写法
export function toDmy(date) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
