// 面积单位换算。公式与 schema.sql 里 land_titles.area_ha 的生成列一致：
//   ha → 原值；sqm ÷ 10000；acre × 0.40468564224；sqft × 0.09290304 ÷ 10000；保留 4 位小数。
export const ACRE_HA = 0.40468564224;
export const SQFT_HA = 0.09290304 / 10000;

export const round = (x, digits) => {
  const f = 10 ** digits;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
};

export function toHa(value, unit) {
  switch (unit) {
    case 'ha':
      return round(value, 4);
    case 'sqm':
      return round(value / 10000, 4);
    case 'acre':
      return round(value * ACRE_HA, 4);
    case 'sqft':
      return round(value * SQFT_HA, 4);
    default:
      throw new Error(`未知面积单位：${unit}`);
  }
}

// 公顷 → 某单位的数值（造地契时倒推纸面数字）
export function fromHa(ha, unit) {
  switch (unit) {
    case 'ha':
      return ha;
    case 'sqm':
      return ha * 10000;
    case 'acre':
      return ha / ACRE_HA;
    case 'sqft':
      return ha / SQFT_HA;
    default:
      throw new Error(`未知面积单位：${unit}`);
  }
}

// 规则比较一律用"万分之一公顷"的整数，避免浮点误差让边界样本翻转
export const toTenThousandths = (ha) => Math.round(ha * 10000);
