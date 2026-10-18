import { describe, expect, it } from 'vitest';
import {
  fieldKind,
  groupByDocument,
  hasEmpty,
  toSubmit,
  unsureFields,
  type ConfirmDocument,
} from './confirm';

const doc = (id: string, data: ConfirmDocument) => ({ id, data });

describe('unsureFields：读不准、还没人确认的字段', () => {
  it('置信度低于 0.7 且没确认：列出；够高的、已确认的不列', () => {
    const rows = unsureFields([
      doc('d1', {
        docType: 'mpob_licence',
        pageNo: 1,
        fields: {
          'mpob_licence.valid_until': {
            rawText: '05/12/2026',
            normalizedValue: '2026-12-05',
            confidence: 0.5,
          },
          'mpob_licence.holder_name': {
            rawText: 'TAN',
            normalizedValue: 'TAN AH KOW',
            confidence: 0.95,
          },
          'mpob_licence.licence_no': {
            rawText: '8102',
            normalizedValue: '8102',
            confidence: 0.3,
            confirmedValue: '810200000022',
          },
        },
      }),
    ]);
    expect(rows).toEqual([
      {
        documentId: 'd1',
        docType: 'mpob_licence',
        pageNo: 1,
        key: 'mpob_licence.valid_until',
        rawText: '05/12/2026',
        value: '2026-12-05',
        kind: 'date',
      },
    ]);
  });

  it('边界与后端一致：先四舍五入到百分之一再比 0.7', () => {
    const f = (c: unknown) =>
      unsureFields([
        doc('d', { docType: 'land_title', fields: { 'land_title.lot_no': { confidence: c } } }),
      ]).length;
    expect(f(0.7)).toBe(0);
    expect(f(0.695)).toBe(0); // 四舍五入成 0.70
    expect(f(0.694)).toBe(1);
    expect(f(0)).toBe(1);
  });

  it('置信度不是正常的数（缺、字符串、NaN）：按读不准处理', () => {
    const f = (c: unknown) =>
      unsureFields([
        doc('d', { docType: 'land_title', fields: { 'land_title.lot_no': { confidence: c } } }),
      ]).length;
    expect(f(undefined)).toBe(1);
    expect(f('high')).toBe(1);
    expect(f(Number.NaN)).toBe(1);
  });

  it('重拍后作废的文件、没有字段的文件、坏数据：跳过', () => {
    expect(
      unsureFields([
        doc('old', {
          docType: 'land_title',
          isCurrent: false,
          fields: { 'land_title.lot_no': { confidence: 0.1 } },
        }),
        doc('empty', { docType: 'land_title' }),
        doc('weird', { docType: 'land_title', fields: { 'land_title.lot_no': null } }),
        { id: 'nodata', data: null },
      ]),
    ).toEqual([]);
  });

  it('确认值是空白不算确认', () => {
    expect(
      unsureFields([
        doc('d', {
          docType: 'land_title',
          fields: { 'land_title.lot_no': { confidence: 0.2, confirmedValue: '  ' } },
        }),
      ]),
    ).toHaveLength(1);
  });

  it('排序：地契 → 执照 → 证书，同一文件按页，持有人按数字顺序（2 在 10 之前）', () => {
    const f = (type: string, key: string) => ({ [key]: { confidence: 0.1 } });
    const rows = unsureFields([
      doc('c', { docType: 'mspo_cert', pageNo: 1, fields: f('mspo_cert', 'mspo_cert.cert_no') }),
      doc('b', {
        docType: 'mpob_licence',
        pageNo: 1,
        fields: f('mpob_licence', 'mpob_licence.valid_until'),
      }),
      doc('a2', {
        docType: 'land_title',
        pageNo: 2,
        fields: {
          'land_title.proprietor_10_name': { confidence: 0.1 },
          'land_title.proprietor_2_name': { confidence: 0.1 },
        },
      }),
      doc('a1', {
        docType: 'land_title',
        pageNo: 1,
        fields: f('land_title', 'land_title.area_value'),
      }),
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      'land_title.area_value',
      'land_title.proprietor_2_name',
      'land_title.proprietor_10_name',
      'mpob_licence.valid_until',
      'mspo_cert.cert_no',
    ]);
  });

  it('原文太长截断；没有页码当第 1 页；值读不出是空串', () => {
    const [r] = unsureFields([
      doc('d', {
        docType: 'land_title',
        fields: { 'land_title.lot_no': { rawText: 'x'.repeat(500), confidence: 0.1 } },
      }),
    ]);
    expect(r.rawText).toHaveLength(200);
    expect(r.pageNo).toBe(1);
    expect(r.value).toBe('');
  });
});

describe('fieldKind', () => {
  it('日期、面积、其余是文字', () => {
    expect(fieldKind('mpob_licence.valid_until')).toBe('date');
    expect(fieldKind('mspo_cert.expiry_date')).toBe('date');
    expect(fieldKind('land_title.lease_expiry')).toBe('date');
    expect(fieldKind('land_title.area_value')).toBe('area');
    expect(fieldKind('land_title.proprietor_1_name')).toBe('text');
  });
});

describe('groupByDocument／toSubmit／hasEmpty', () => {
  const fields = unsureFields([
    doc('d1', {
      docType: 'land_title',
      fields: {
        'land_title.area_value': { rawText: '3.O4', normalizedValue: '3.0400', confidence: 0.4 },
        'land_title.lot_no': { rawText: '22I7', normalizedValue: '2217', confidence: 0.5 },
      },
    }),
    doc('d2', {
      docType: 'mpob_licence',
      fields: { 'mpob_licence.valid_until': { normalizedValue: '', confidence: 0.1 } },
    }),
  ]);
  const groups = groupByDocument(fields);

  it('每个文件一组，保持顺序', () => {
    expect(groups.map((g) => [g.documentId, g.fields.length])).toEqual([
      ['d1', 2],
      ['d2', 1],
    ]);
  });

  it('提交：改过的用改的，没改的用读出的值（= 这些都对），两端去空白', () => {
    expect(
      toSubmit(groups, {
        'd1|land_title.area_value': ' 3.04 ',
        'd2|mpob_licence.valid_until': '2026-12-05',
      }),
    ).toEqual({
      d1: { 'land_title.area_value': '3.04', 'land_title.lot_no': '2217' },
      d2: { 'mpob_licence.valid_until': '2026-12-05' },
    });
  });

  it('读不出来又没填：空值，要拦住', () => {
    expect(hasEmpty(toSubmit(groups, {}))).toBe(true);
    expect(hasEmpty(toSubmit(groups, { 'd2|mpob_licence.valid_until': '2026-12-05' }))).toBe(false);
    expect(hasEmpty(toSubmit(groups, { 'd2|mpob_licence.valid_until': '   ' }))).toBe(true);
  });
});
