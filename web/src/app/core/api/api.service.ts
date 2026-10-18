import { InjectionToken, Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../firebase/auth.service';

// 调后端 API 的唯一出口（前端对 Firestore 只读，写入都走这里）。形状见 contract/api.md 与 api/README.md。
// 每个请求带 Authorization: Bearer <Firebase ID token>；错误统一成 ApiError，界面按 code 生成文案，不显示服务器的英文 message。

/** 界面能分辨的失败原因：服务器返回的 snake_case 错误码，或本地产生的 not_configured／network／unauthenticated */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** 服务器在错误体里附带的字段，如 409 的 assessmentId */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** 后端根网址（不带结尾斜杠）。默认取环境配置；测试里换成假的 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});

export interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export type DocKind = 'land_title' | 'mpob_licence' | 'mspo_cert';

export type GeometryBody =
  | { geometryType: 'polygon'; polygon: { type: 'Polygon'; coordinates: number[][][] } }
  | {
      geometryType: 'point';
      point: { lng: number; lat: number };
      areaHaDeclared: number;
    };

export interface SavedGeometry {
  plotId: string;
  geometryType: 'polygon' | 'point';
  areaHaComputed: number | null;
  areaHaDeclared: number | null;
  centroid: { lat: number; lng: number };
}

export interface Profile {
  uid: string;
  role: string;
  language: string;
  personId: string | null;
  coopId: string | null;
}

export interface VoiceReply {
  transcript: string;
  answer: string;
  lang: 'ms' | 'en';
  /** false：问题不在范围内（只回答这块地、EUDR、需要的文件），answer 是固定的拒绝语。旧后端没有这一项，当 true */
  inScope?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');

  /** 后端地址配置了没有（没有就不要去连） */
  readonly configured = this.base !== '';

  /** 首次登录建档（只会建园主）；已有档案直接返回 */
  me(body: { fullName?: string; language?: 'ms' | 'en' } = {}): Promise<Profile> {
    return this.request<Profile>('POST', '/api/me', body);
  }

  /** 新建一块空地。外勤替成员新建时带 memberId */
  async createPlot(memberId: string | null): Promise<string> {
    const res = await this.request<{ plotId: string }>(
      'POST',
      '/api/plots',
      memberId ? { memberId } : {},
    );
    return res.plotId;
  }

  /** 保存多边形或一个点；面积与质心由后端重算，返回的是最终值 */
  saveGeometry(plotId: string, body: GeometryBody): Promise<SavedGeometry> {
    return this.request<SavedGeometry>('PATCH', `/api/plots/${encodeURIComponent(plotId)}`, body);
  }

  /** 登记一份文件，拿到 15 分钟有效的上传网址 */
  registerDocument(
    plotId: string,
    body: {
      docType: DocKind;
      contentType: 'image/jpeg';
      source: 'camera' | 'gallery';
      /** 一份证件的第几页（1–4）；不写就是第 1 页 */
      pageNo?: number;
    },
  ): Promise<{ documentId: string; upload: UploadTarget }> {
    return this.request('POST', `/api/plots/${encodeURIComponent(plotId)}/documents`, body);
  }

  /** 照片直传到签名网址，不经过 API，也不带 Authorization（签名网址自带授权，多带头会被拒） */
  async uploadPhoto(target: UploadTarget, photo: Blob): Promise<void> {
    let res: Response;
    try {
      res = await fetch(target.url, {
        method: target.method,
        headers: target.headers,
        body: photo,
      });
    } catch {
      throw new ApiError(0, 'network');
    }
    if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  }

  /** 屏 8：用户确认（或改过）读出的字段。后端先全部校验再写，有一个不合格就一个都不写（400 invalid_value／unknown_field） */
  async confirmFields(documentId: string, fields: Record<string, string>): Promise<void> {
    await this.request('PATCH', `/api/documents/${encodeURIComponent(documentId)}/fields`, {
      fields,
    });
  }

  /** 原件照片的读取网址（15 分钟有效）；照片还没传上来（种子里的文件）抛 404 image_not_found */
  documentImage(documentId: string): Promise<{ url: string; expiresAt: string }> {
    return this.request('GET', `/api/documents/${encodeURIComponent(documentId)}/image`);
  }

  /** 触发评估。已有评估在跑时抛 409（ApiError.extra.assessmentId 是那一条） */
  async assess(plotId: string): Promise<string> {
    const res = await this.request<{ assessmentId: string }>(
      'POST',
      `/api/plots/${encodeURIComponent(plotId)}/assess`,
    );
    return res.assessmentId;
  }

  /** 语音问答：音频是 16 kHz 单声道 WAV 的 base64。回「听到了什么」和一两句回答（手机负责念出来） */
  askVoice(
    plotId: string,
    body: { audio: string; mimeType: 'audio/wav'; lang: 'ms' | 'en' },
  ): Promise<VoiceReply> {
    return this.request<VoiceReply>('POST', `/api/plots/${encodeURIComponent(plotId)}/voice`, body);
  }

  /** 打字问：最长 300 字。只回答这块地、EUDR、需要的文件；别的问题 inScope 为 false，answer 是拒绝语 */
  askText(plotId: string, body: { text: string; lang: 'ms' | 'en' }): Promise<VoiceReply> {
    return this.request<VoiceReply>('POST', `/api/plots/${encodeURIComponent(plotId)}/ask`, body);
  }

  /** 删掉整块地（连文件、评估）。演示用的模拟地块抛 403 demo_data_protected，评估在跑抛 409 assessment_in_progress */
  async deletePlot(plotId: string): Promise<void> {
    await this.request('DELETE', `/api/plots/${encodeURIComponent(plotId)}`);
  }

  /** 删掉其中一张照片 */
  async deleteDocument(documentId: string): Promise<void> {
    await this.request('DELETE', `/api/documents/${encodeURIComponent(documentId)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new ApiError(0, 'not_configured');
    const token = await this.auth.idToken();
    if (!token) throw new ApiError(401, 'unauthenticated');
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network');
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const { error, ...extra } = json ?? {};
      const code = (error as { code?: unknown } | undefined)?.code;
      throw new ApiError(res.status, typeof code === 'string' ? code : 'http_error', extra);
    }
    return json as T;
  }
}
