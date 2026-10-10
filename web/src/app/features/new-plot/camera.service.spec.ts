import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CameraError, CameraService, classifyCameraError } from './camera.service';

const domError = (name: string) => Object.assign(new Error(name), { name });

function fakeStream(capabilities: Record<string, unknown> | undefined = {}) {
  const stop = vi.fn();
  const applyConstraints = vi.fn().mockResolvedValue(undefined);
  const listeners: Record<string, () => void> = {};
  const track = {
    stop,
    applyConstraints,
    getCapabilities: capabilities === undefined ? undefined : () => capabilities,
    addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stop, applyConstraints, listeners };
}

function withMediaDevices(
  getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | undefined,
) {
  vi.stubGlobal('navigator', { mediaDevices: getUserMedia ? { getUserMedia } : undefined });
  return TestBed.inject(CameraService);
}

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'none'],
    ['DevicesNotFoundError', 'none'],
    ['OverconstrainedError', 'none'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
    ['SomethingElse', 'other'],
  ])('%s → %s', (name, key) => {
    expect(classifyCameraError(domError(name))).toBe(key);
  });

  it('不是错误对象也不崩：归为 other', () => {
    for (const v of [null, undefined, 'x', 42, {}]) expect(classifyCameraError(v)).toBe('other');
  });
});

describe('CameraService.open', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('非安全上下文（navigator.mediaDevices 为 undefined）：抛 insecure，不抛 TypeError', async () => {
    const service = withMediaDevices(undefined);
    await expect(service.open()).rejects.toMatchObject({ name: 'CameraError', key: 'insecure' });
  });

  it('优先后置摄像头，成功返回句柄', async () => {
    const { stream } = fakeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    const handle = await withMediaDevices(gum).open();
    expect(handle.stream).toBe(stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum.mock.calls[0][0]).toMatchObject({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('取不到后置（OverconstrainedError／NotFoundError）：退回任意摄像头再试一次', async () => {
    for (const name of ['OverconstrainedError', 'NotFoundError']) {
      const { stream } = fakeStream();
      const gum = vi.fn().mockRejectedValueOnce(domError(name)).mockResolvedValueOnce(stream);
      const handle = await withMediaDevices(gum).open();
      expect(handle.stream, name).toBe(stream);
      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum.mock.calls[1][0]).toEqual({ video: true, audio: false });
      vi.unstubAllGlobals();
    }
  });

  it('退回之后仍然没有摄像头：none', async () => {
    const gum = vi.fn().mockRejectedValue(domError('NotFoundError'));
    await expect(withMediaDevices(gum).open()).rejects.toMatchObject({ key: 'none' });
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it('被拒、被占用、其他失败：不重试，直接按类别抛', async () => {
    for (const [name, key] of [
      ['NotAllowedError', 'denied'],
      ['NotReadableError', 'busy'],
      ['Weird', 'other'],
    ]) {
      const gum = vi.fn().mockRejectedValue(domError(name));
      await expect(withMediaDevices(gum).open()).rejects.toBeInstanceOf(CameraError);
      expect(gum, name).toHaveBeenCalledTimes(1);
      await expect(withMediaDevices(gum).open()).rejects.toMatchObject({ key });
      vi.unstubAllGlobals();
    }
  });
});

describe('CameraHandle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('手电筒只在轨道声明支持时才可用', async () => {
    const yes = await withMediaDevices(
      vi.fn().mockResolvedValue(fakeStream({ torch: true }).stream),
    ).open();
    expect(yes.torchSupported).toBe(true);
    vi.unstubAllGlobals();

    const no = await withMediaDevices(vi.fn().mockResolvedValue(fakeStream({}).stream)).open();
    expect(no.torchSupported).toBe(false);
    vi.unstubAllGlobals();

    // getCapabilities 本身不存在（iOS Safari、旧浏览器）：不崩，按不支持处理
    const none = await withMediaDevices(
      vi.fn().mockResolvedValue(fakeStream(undefined).stream),
    ).open();
    expect(none.torchSupported).toBe(false);
  });

  it('开关手电筒：用 advanced 约束', async () => {
    const f = fakeStream({ torch: true });
    const handle = await withMediaDevices(vi.fn().mockResolvedValue(f.stream)).open();
    await handle.setTorch(true);
    expect(f.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    await handle.setTorch(false);
    expect(f.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it('stop 停掉所有轨道；轨道被系统结束时回调', async () => {
    const f = fakeStream();
    const handle = await withMediaDevices(vi.fn().mockResolvedValue(f.stream)).open();
    const ended = vi.fn();
    handle.onEnded(ended);
    f.listeners['ended']();
    expect(ended).toHaveBeenCalledTimes(1);
    handle.stop();
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
});
