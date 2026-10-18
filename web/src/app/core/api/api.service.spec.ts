import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../firebase/auth.service';
import { API_BASE_URL, ApiError, ApiService } from './api.service';

function setup(opts: { base?: string; token?: string | null } = {}) {
  const idToken = vi.fn(async () => (opts.token === undefined ? 'tok-1' : opts.token));
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { idToken } },
      { provide: API_BASE_URL, useValue: opts.base ?? 'http://api.test/' },
    ],
  });
  return { api: TestBed.inject(ApiService), idToken };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('带 Bearer token、JSON 请求体，去掉根网址结尾的斜杠', async () => {
    fetchMock.mockResolvedValue(json(201, { plotId: 'p1' }));
    const { api } = setup();
    expect(await api.createPlot('person-9')).toBe('p1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/plots');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ memberId: 'person-9' });
  });

  it('园主自己新建：请求体是空对象，不带 memberId', async () => {
    fetchMock.mockResolvedValue(json(201, { plotId: 'p1' }));
    const { api } = setup();
    await api.createPlot(null);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it('没配置后端地址：不发请求，抛 not_configured', async () => {
    const { api } = setup({ base: '' });
    expect(api.configured).toBe(false);
    await expect(api.assess('p1')).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('没登录：不发请求，抛 unauthenticated', async () => {
    const { api } = setup({ token: null });
    await expect(api.assess('p1')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('网络断了：抛 network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { api } = setup();
    await expect(api.assess('p1')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('服务器错误：取 error.code，其余字段放进 extra（409 的 assessmentId）', async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: 'assessment_in_progress', message: 'x' }, assessmentId: 'a-7' }),
    );
    const { api } = setup();
    const err = await api.assess('p1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: 'assessment_in_progress',
      extra: { assessmentId: 'a-7' },
    });
  });

  it('错误体不是 JSON：http_error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const { api } = setup();
    await expect(api.assess('p1')).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('地块 id 会转义进路径', async () => {
    fetchMock.mockResolvedValue(json(202, { assessmentId: 'a1' }));
    const { api } = setup();
    expect(await api.assess('a/b')).toBe('a1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/plots/a%2Fb/assess');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('照片直传：用后端给的网址和头，不带 Authorization', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { api, idToken } = setup();
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    await api.uploadPhoto(
      {
        method: 'PUT',
        url: 'https://bucket/signed',
        headers: { 'Content-Type': 'image/jpeg' },
        expiresAt: '',
      },
      photo,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bucket/signed');
    expect(init).toEqual({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: photo });
    expect(idToken).not.toHaveBeenCalled();
  });

  it('照片直传失败：upload_failed；断网：network', async () => {
    const { api } = setup();
    const target = { method: 'PUT' as const, url: 'https://b/s', headers: {}, expiresAt: '' };
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(api.uploadPhoto(target, new Blob(['x']))).rejects.toMatchObject({
      status: 403,
      code: 'upload_failed',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(api.uploadPhoto(target, new Blob(['x']))).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('确认字段：PATCH 到文件的 fields，带字段键和值', async () => {
    fetchMock.mockResolvedValue(json(200, { documentId: 'd/1', fields: {} }));
    const { api } = setup();
    await api.confirmFields('d/1', { 'mpob_licence.valid_until': '2026-12-05' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/documents/d%2F1/fields');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ fields: { 'mpob_licence.valid_until': '2026-12-05' } });
  });

  it('确认字段被拒（400）：抛 invalid_value', async () => {
    fetchMock.mockResolvedValue(json(400, { error: { code: 'invalid_value', message: 'x' } }));
    const { api } = setup();
    await expect(api.confirmFields('d1', { a: 'b' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_value',
    });
  });

  it('原件网址：GET，没有请求体；照片没传上来是 404', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { url: 'https://x/y.jpg', expiresAt: '2026-10-18T10:00:00Z' }),
    );
    const { api } = setup();
    expect(await api.documentImage('d1')).toEqual({
      url: 'https://x/y.jpg',
      expiresAt: '2026-10-18T10:00:00Z',
    });
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    fetchMock.mockResolvedValueOnce(
      json(404, { error: { code: 'image_not_found', message: 'x' } }),
    );
    await expect(api.documentImage('d2')).rejects.toMatchObject({
      status: 404,
      code: 'image_not_found',
    });
  });
});
