import { en } from '../../core/i18n/dict.en';
import { ms } from '../../core/i18n/dict.ms';
import type { AssessmentData, GapItem } from './assessment';
import { inlineDocName } from '../../core/i18n/gap-text';
import { gapView } from './gap-view';

const assessment: AssessmentData = { ruleResults: [], gaps: [] };
const gap = (code: GapItem['code'], docType: string | null): GapItem => ({
  key: code,
  code,
  known: code as GapItem['known'],
  docType,
  severity: 'medium',
});

describe('inlineDocName（句中的文件名）', () => {
  it('首字母小写；首词是全大写缩写（MPOB、MSPO）的不动', () => {
    expect(inlineDocName('Geran tanah')).toBe('geran tanah');
    expect(inlineDocName('Lesen MPOB')).toBe('lesen MPOB');
    expect(inlineDocName('Sijil MSPO')).toBe('sijil MSPO');
    expect(inlineDocName('Dokumen')).toBe('dokumen');
    expect(inlineDocName('Land title')).toBe('land title');
    expect(inlineDocName('MPOB licence')).toBe('MPOB licence');
    expect(inlineDocName('MSPO member list')).toBe('MSPO member list');
  });
});

describe('gapView：句首大写、句中小写', () => {
  it('马来语：标题开头仍大写，句中的文件名小写', () => {
    expect(gapView(ms, 'ms', assessment, gap('expiring', 'mpob_licence')).title).toBe(
      'Lesen MPOB hampir tamat',
    );
    expect(gapView(ms, 'ms', assessment, gap('expiring', 'mpob_licence')).advice).toContain(
      'Mohon pembaharuan lesen MPOB lebih awal',
    );
    expect(gapView(ms, 'ms', assessment, gap('name_mismatch', 'land_title')).title).toBe(
      'Nama pada geran tanah tidak sepadan',
    );
    expect(gapView(ms, 'ms', assessment, gap('low_confidence', 'mspo_cert')).title).toBe(
      'Tulisan pada sijil MSPO kurang jelas',
    );
  });

  it('英语：land title 小写，MPOB／MSPO 开头的不改', () => {
    expect(gapView(en, 'en', assessment, gap('name_mismatch', 'land_title')).title).toBe(
      "The name on the land title doesn't match",
    );
    expect(gapView(en, 'en', assessment, gap('low_confidence', 'mspo_cert')).title).toBe(
      'The writing on the MSPO certificate is unclear',
    );
    expect(gapView(en, 'en', assessment, gap('expiring', 'mpob_licence')).advice).toContain(
      'renew the MPOB licence early',
    );
  });

  it('没有 docType：通用的「dokumen」／「document」，不出现 undefined', () => {
    const v = gapView(ms, 'ms', assessment, gap('name_mismatch', null));
    expect(v.title).toBe('Nama pada dokumen tidak sepadan');
    expect(v.title).not.toContain('undefined');
  });

  it('expired 的建议：只有 MPOB 执照提「fi lewat」，其他文件不提', () => {
    expect(gapView(ms, 'ms', assessment, gap('expired', 'mpob_licence')).advice).toContain(
      'mungkin ada fi lewat',
    );
    expect(gapView(ms, 'ms', assessment, gap('expired', 'mspo_cert')).advice).not.toContain(
      'fi lewat',
    );
    expect(gapView(ms, 'ms', assessment, gap('expired', 'mspo_cert')).advice).toBe(
      'Perbaharui sijil MSPO dahulu, kemudian ambil gambar yang baharu.',
    );
    expect(gapView(en, 'en', assessment, gap('expired', 'mpob_licence')).advice).toContain(
      'late fees may apply',
    );
    expect(gapView(en, 'en', assessment, gap('expired', 'land_title')).advice).toBe(
      'Renew the land title first, then take a new photo.',
    );
  });
});
