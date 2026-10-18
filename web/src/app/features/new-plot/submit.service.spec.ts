import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiService } from '../../core/api/api.service';
import { DraftService } from './draft.service';
import type { LngLat } from './geometry';
import { SubmitService, geometryBody } from './submit.service';

const RECT: LngLat[] = [
  [101.16106, 4.326776],
  [101.162991, 4.326776],
  [101.162991, 4.325064],
  [101.16106, 4.325064],
];

function fakeApi(overrides: Partial<Record<string, unknown>> = {}) {
  let docNo = 0;
  return {
    createPlot: vi.fn(async () => 'plot-1'),
    saveGeometry: vi.fn(async () => ({})),
    registerDocument: vi.fn(async () => ({
      documentId: `d${++docNo}`,
      upload: { method: 'PUT', url: `https://up/${docNo}`, headers: {}, expiresAt: '' },
    })),
    uploadPhoto: vi.fn(async () => undefined),
    assess: vi.fn(async () => 'a-1'),
    ...overrides,
  };
}

function setup(api = fakeApi(), prep?: (d: DraftService) => void) {
  TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  const draft = TestBed.inject(DraftService);
  for (const v of RECT) draft.addVertex('map', v);
  prep?.(draft);
  return { api, draft, submit: TestBed.inject(SubmitService) };
}

const photo = () => new Blob(['jpeg'], { type: 'image/jpeg' });

describe('geometryBody', () => {
  it('多边形：闭合的 GeoJSON，坐标是 [经度, 纬度]', () => {
    const { draft } = setup();
    const body = geometryBody(draft.geometry()!);
    expect(body.geometryType).toBe('polygon');
    if (body.geometryType !== 'polygon') throw new Error('unreachable');
    const ring = body.polygon.coordinates[0];
    expect(ring[0]).toEqual([101.16106, 4.326776]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it('一个点：lng/lat 和手填面积', () => {
    const { draft } = setup(fakeApi(), (d) => {
      d.setTab('point');
      d.setPoint([101.1, 4.3]);
      d.setDeclared('2,5');
    });
    expect(geometryBody(draft.geometry()!)).toEqual({
      geometryType: 'point',
      point: { lng: 101.1, lat: 4.3 },
      areaHaDeclared: 2.5,
    });
  });
});

describe('SubmitService', () => {
  it('依次：建地块 → 存位置 → 每张照片登记并直传 → 触发评估；跳过的文档不传', async () => {
    const { api, draft, submit } = setup(fakeApi(), (d) => {
      d.begin('person-9');
      for (const v of RECT) d.addVertex('map', v);
      d.capture('land_title', photo(), 'camera');
      d.capture('mpob_licence', photo(), 'gallery');
      d.skip('mspo_cert');
    });
    const steps: string[] = [];
    const plotId = await submit.run((p) => steps.push(`${p.step}:${p.done}/${p.total}`));
    expect(plotId).toBe('plot-1');
    expect(api.createPlot).toHaveBeenCalledWith('person-9');
    expect(api.saveGeometry).toHaveBeenCalledWith(
      'plot-1',
      expect.objectContaining({ geometryType: 'polygon' }),
    );
    expect(api.registerDocument).toHaveBeenCalledTimes(2);
    expect(api.registerDocument).toHaveBeenCalledWith('plot-1', {
      docType: 'land_title',
      contentType: 'image/jpeg',
      source: 'camera',
    });
    expect(api.registerDocument).toHaveBeenCalledWith('plot-1', {
      docType: 'mpob_licence',
      contentType: 'image/jpeg',
      source: 'gallery',
    });
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(api.assess).toHaveBeenCalledWith('plot-1');
    // 评估必须排在所有上传之后
    expect(api.assess.mock.invocationCallOrder[0]).toBeGreaterThan(
      api.uploadPhoto.mock.invocationCallOrder[1],
    );
    expect(steps[0]).toBe('plot:0/0');
    expect(steps).toContain('docs:2/2');
    expect(steps.at(-1)).toBe('assess:0/0');
    expect(draft.plotId()).toBe('plot-1');
  });

  it('草稿没有可完成的位置：抛 no_geometry，什么都不调', async () => {
    const api = fakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    await expect(TestBed.inject(SubmitService).run(() => undefined)).rejects.toMatchObject({
      code: 'no_geometry',
    });
    expect(api.createPlot).not.toHaveBeenCalled();
  });

  it('上传失败后重试：不重复建地块、不重复传已传好的照片', async () => {
    const api = fakeApi();
    api.uploadPhoto.mockRejectedValueOnce(new ApiError(0, 'network'));
    const { draft, submit } = setup(api, (d) => {
      d.capture('land_title', photo(), 'camera');
      d.capture('mpob_licence', photo(), 'camera');
    });
    await expect(submit.run(() => undefined)).rejects.toMatchObject({ code: 'network' });
    expect(api.assess).not.toHaveBeenCalled();
    expect(draft.plotId()).toBe('plot-1');
    const uploadedBefore = draft.uploaded.size; // 失败的那张没记，成功的那张记了

    await submit.run(() => undefined);
    expect(api.createPlot).toHaveBeenCalledTimes(1);
    expect(api.saveGeometry).toHaveBeenCalledTimes(2); // 位置每次都重新保存
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2 + 2 - uploadedBefore);
    expect(api.assess).toHaveBeenCalledTimes(1);
  });

  it('重拍之后重新上传那一张', async () => {
    const { api, draft, submit } = setup(fakeApi(), (d) =>
      d.capture('land_title', photo(), 'camera'),
    );
    await submit.run(() => undefined);
    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    draft.capture('land_title', photo(), 'camera');
    await submit.run(() => undefined);
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('评估已经在跑（409）：当作成功', async () => {
    const api = fakeApi({
      assess: vi.fn(async () => {
        throw new ApiError(409, 'assessment_in_progress', { assessmentId: 'a-0' });
      }),
    });
    const { submit } = setup(api);
    await expect(submit.run(() => undefined)).resolves.toBe('plot-1');
  });

  it('评估触发失败（别的错误）：照样抛出', async () => {
    const api = fakeApi({
      assess: vi.fn(async () => {
        throw new ApiError(500, 'http_error');
      }),
    });
    const { submit } = setup(api);
    await expect(submit.run(() => undefined)).rejects.toMatchObject({ status: 500 });
  });

  it('草稿重新开始（begin）：忘掉上一次建的地块', async () => {
    const { draft, submit } = setup();
    await submit.run(() => undefined);
    expect(draft.plotId()).toBe('plot-1');
    draft.begin(null);
    expect(draft.plotId()).toBeNull();
    expect(draft.uploaded.size).toBe(0);
  });
});


describe('SubmitService：已有的地块', () => {
  it('runDocuments：只传照片和重新评估，不建地块、不动位置；传过的重试时不重传', async () => {
    const { api, draft, submit } = setup(fakeApi(), (d) => {
      d.capture('land_title', photo(), 'camera');
      d.addPage('land_title', photo(), 'gallery');
    });
    const steps: string[] = [];
    await submit.runDocuments('plot-7', (p) => steps.push(`${p.step}:${p.done}/${p.total}`));
    expect(api.createPlot).not.toHaveBeenCalled();
    expect(api.saveGeometry).not.toHaveBeenCalled();
    expect(api.registerDocument).toHaveBeenCalledTimes(2);
    expect(api.registerDocument).toHaveBeenCalledWith(
      'plot-7',
      expect.objectContaining({ docType: 'land_title', pageNo: 2 }),
    );
    expect(api.assess).toHaveBeenCalledWith('plot-7');
    expect(steps.at(-1)).toBe('assess:0/0');

    // 重试：已经传好的不再传，评估照样触发
    api.registerDocument.mockClear();
    await submit.runDocuments('plot-7', () => undefined);
    expect(api.registerDocument).not.toHaveBeenCalled();
    expect(api.assess).toHaveBeenCalledTimes(2);
    expect(draft.uploaded.size).toBe(2);
  });

  it('runDocuments：已经有评估在跑（409）当作成功', async () => {
    const api = fakeApi({
      assess: vi.fn(async () => {
        throw new ApiError(409, 'assessment_in_progress');
      }),
    });
    const { submit } = setup(api, (d) => d.capture('mpob_licence', photo(), 'camera'));
    await expect(submit.runDocuments('p', () => undefined)).resolves.toBeUndefined();
  });

  it('runRedraw：只存新位置和重新评估，不建地块、不传照片', async () => {
    const { api, submit } = setup();
    await submit.runRedraw('plot-7', () => undefined);
    expect(api.createPlot).not.toHaveBeenCalled();
    expect(api.registerDocument).not.toHaveBeenCalled();
    expect(api.saveGeometry).toHaveBeenCalledWith(
      'plot-7',
      expect.objectContaining({ geometryType: 'polygon' }),
    );
    expect(api.assess).toHaveBeenCalledWith('plot-7');
  });

  it('runRedraw：没画好就报 no_geometry', async () => {
    const empty = setup(fakeApi(), (d) => d.reset());
    await expect(empty.submit.runRedraw('p', () => undefined)).rejects.toMatchObject({
      code: 'no_geometry',
    });
  });

  it('runRedraw：保存失败原样抛出，不触发评估', async () => {
    const api = fakeApi({
      saveGeometry: vi.fn(async () => {
        throw new ApiError(422, 'geometry_invalid');
      }),
    });
    const { submit } = setup(api);
    await expect(submit.runRedraw('p', () => undefined)).rejects.toMatchObject({
      code: 'geometry_invalid',
    });
    expect(api.assess).not.toHaveBeenCalled();
  });
});
