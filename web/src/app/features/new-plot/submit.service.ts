import { Injectable, inject } from '@angular/core';
import { ApiError, ApiService, type GeometryBody } from '../../core/api/api.service';
import { DOC_TYPES, DraftService } from './draft.service';
import { toGeoJsonPolygon, type PlotGeometry } from './geometry';

// 屏 6「开始检查」：把草稿交给后端——建地块 → 保存位置与面积 → 登记并直传每份照片 → 触发评估。
// 评估在后端异步跑，结果靠 Firestore 订阅（屏 7、屏 9）；这里只管把东西送过去。
// 可以重试：已经建好的地块（draft.plotId）和已传好的照片（draft.uploaded）不会重复建、重复传；
// 位置每次都重新保存（PATCH 本来就是覆盖，用户可能回去改过多边形）。

export type SubmitStep = 'plot' | 'area' | 'docs' | 'assess';

export interface SubmitProgress {
  step: SubmitStep;
  /** step === 'docs' 时：已传好几份／一共几份要传 */
  done: number;
  total: number;
}

/** 屏 5 的中性形状 → 合同里的请求体（contract/api.md：PATCH /api/plots/{id}） */
export function geometryBody(g: PlotGeometry): GeometryBody {
  return g.kind === 'polygon'
    ? { geometryType: 'polygon', polygon: toGeoJsonPolygon(g.ring) }
    : {
        geometryType: 'point',
        point: { lng: g.point[0], lat: g.point[1] },
        areaHaDeclared: g.declaredHa,
      };
}

@Injectable({ providedIn: 'root' })
export class SubmitService {
  private readonly api = inject(ApiService);
  private readonly draft = inject(DraftService);

  /** 成功返回地块 id（可以去屏 7 了）；失败抛 ApiError，已完成的步骤保留 */
  async run(onProgress: (p: SubmitProgress) => void): Promise<string> {
    const geometry = this.draft.geometry();
    if (!geometry) throw new ApiError(0, 'no_geometry');

    onProgress({ step: 'plot', done: 0, total: 0 });
    let plotId = this.draft.plotId();
    if (!plotId) {
      plotId = await this.api.createPlot(this.draft.memberId());
      this.draft.plotId.set(plotId);
    }

    onProgress({ step: 'area', done: 0, total: 0 });
    await this.api.saveGeometry(plotId, geometryBody(geometry));

    // 每份文件的每一页都要传：第 n 页登记成 pageNo = n（第 1 页不带，和后端的默认值一致）
    const todo = DOC_TYPES.flatMap((type) =>
      this.draft.pagesOf(type).flatMap((page, i) =>
        this.draft.uploaded.get(`${type}#${i + 1}`) !== page.blob
          ? [
              {
                key: `${type}#${i + 1}`,
                type,
                pageNo: i + 1,
                blob: page.blob,
                source: page.source,
              },
            ]
          : [],
      ),
    );
    let done = 0;
    onProgress({ step: 'docs', done, total: todo.length });
    await Promise.all(
      todo.map(async ({ key, type, pageNo, blob, source }) => {
        const reg = await this.api.registerDocument(plotId, {
          docType: type,
          contentType: 'image/jpeg',
          source,
          ...(pageNo > 1 ? { pageNo } : {}),
        });
        await this.api.uploadPhoto(reg.upload, blob);
        this.draft.uploaded.set(key, blob);
        onProgress({ step: 'docs', done: ++done, total: todo.length });
      }),
    );

    onProgress({ step: 'assess', done: 0, total: 0 });
    try {
      await this.api.assess(plotId);
    } catch (err) {
      // 这块地已经有一次评估在跑（上次点过、网络断了没收到回复）：当作成功，屏 7 会接着显示它
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    return plotId;
  }
}
