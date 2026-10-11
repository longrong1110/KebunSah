import { vi } from 'vitest';
import {
  ImageProblem,
  JPEG_QUALITY,
  MAX_FILE_BYTES,
  MAX_LONG_SIDE,
  checkFile,
  compressFile,
  fitWithin,
  renderJpeg,
  type CanvasLike,
  type DecodedImage,
} from './image';

function fakeCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
  // 记下 fillRect／drawImage 的先后，验证先铺白底再画
  const calls: string[] = [];
  const draw = vi.fn(() => {
    calls.push('draw');
  });
  const ctx = {
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    fillRect: vi.fn(() => {
      calls.push(`fill:${String(ctx.fillStyle)}`);
    }),
    drawImage: draw,
  };
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(blob));
  const canvas: CanvasLike & { sizes: [number, number][] } = {
    width: 0,
    height: 0,
    sizes: [],
    getContext: () => ctx,
    toBlob,
  };
  // 记下每次被设置过的尺寸，用来验证"用完置 0"
  let w = 0;
  let h = 0;
  Object.defineProperty(canvas, 'width', {
    get: () => w,
    set: (v) => {
      w = v;
      canvas.sizes.push([w, h]);
    },
  });
  Object.defineProperty(canvas, 'height', {
    get: () => h,
    set: (v) => {
      h = v;
      canvas.sizes.push([w, h]);
    },
  });
  return { canvas, draw, toBlob, ctx, calls };
}

describe('fitWithin', () => {
  it('长边超过上限：等比缩到长边 = 上限', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 }); // 竖拍
    expect(fitWithin(8000, 8000)).toEqual({ width: 1600, height: 1600 });
  });

  it('小图不放大：长边不超过上限就原样', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1000)).toEqual({ width: 1600, height: 1000 });
  });

  it('宽高比保持（允许 1 像素取整误差），极端细长图也不会变成 0', () => {
    const { width, height } = fitWithin(4032, 3024);
    expect(Math.abs(width / height - 4032 / 3024)).toBeLessThan(0.01);
    expect(fitWithin(20000, 10)).toEqual({ width: 1600, height: 1 });
  });

  it('上限是单一常量 1600', () => {
    expect(MAX_LONG_SIDE).toBe(1600);
    expect(fitWithin(3200, 1600, 800)).toEqual({ width: 800, height: 400 });
  });
});

describe('checkFile', () => {
  it('不是图片：notImage；太大（>20MB）：tooBig；正常：null', () => {
    expect(checkFile({ type: 'application/pdf', size: 10 })).toBe('notImage');
    expect(checkFile({ type: '', size: 10 })).toBeNull(); // type 为空：放行，交给解码判断（HEIC 没有 MIME）
    expect(checkFile({ type: '', size: MAX_FILE_BYTES + 1 })).toBe('tooBig');
    expect(checkFile({ type: 'image/jpeg', size: MAX_FILE_BYTES + 1 })).toBe('tooBig');
    expect(checkFile({ type: 'image/jpeg', size: MAX_FILE_BYTES })).toBeNull();
    expect(checkFile({ type: 'image/heic', size: 1000 })).toBeNull();
  });
});

describe('renderJpeg', () => {
  it('先铺白底再画图：透明的 PNG 压成 JPEG 后透明处是白色，不是黑色', async () => {
    const { canvas, ctx, calls } = fakeCanvas();
    await renderJpeg({} as CanvasImageSource, 800, 600, () => canvas);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(calls).toEqual(['fill:#ffffff', 'draw']);
  });

  it('缩放后编码成 JPEG（质量 0.85），并在用完后把 canvas 尺寸置 0', async () => {
    const { canvas, draw, toBlob } = fakeCanvas();
    const blob = await renderJpeg({} as CanvasImageSource, 4000, 3000, () => canvas);
    expect(blob.type).toBe('image/jpeg');
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', JPEG_QUALITY);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(canvas.sizes.at(-1)).toEqual([0, 0]);
  });

  it('小图不放大', async () => {
    const { canvas, draw } = fakeCanvas();
    await renderJpeg({} as CanvasImageSource, 800, 600, () => canvas);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
  });

  it('尺寸无效、拿不到 2d 上下文、编码失败：抛 unreadable，且仍然释放 canvas', async () => {
    await expect(renderJpeg({} as CanvasImageSource, 0, 100)).rejects.toMatchObject({
      key: 'unreadable',
    });

    const noCtx = fakeCanvas();
    noCtx.canvas.getContext = () => null;
    await expect(
      renderJpeg({} as CanvasImageSource, 100, 100, () => noCtx.canvas),
    ).rejects.toBeInstanceOf(ImageProblem);
    expect(noCtx.canvas.sizes.at(-1)).toEqual([0, 0]);

    const failed = fakeCanvas(null);
    await expect(
      renderJpeg({} as CanvasImageSource, 100, 100, () => failed.canvas),
    ).rejects.toMatchObject({ key: 'unreadable' });
    expect(failed.canvas.sizes.at(-1)).toEqual([0, 0]);
  });
});

describe('compressFile', () => {
  const file = (type = 'image/jpeg', size = 1000) => ({ type, size, name: 'x' }) as unknown as File;
  const decoded = (release = vi.fn()): DecodedImage => ({
    source: {} as CanvasImageSource,
    width: 3000,
    height: 4000,
    release,
  });

  it('文件不对不会去解码：非图片 → notImage，太大 → tooBig', async () => {
    const decode = vi.fn();
    await expect(compressFile(file('text/plain'), { decode })).rejects.toMatchObject({
      key: 'notImage',
    });
    await expect(
      compressFile(file('image/jpeg', MAX_FILE_BYTES + 1), { decode }),
    ).rejects.toMatchObject({ key: 'tooBig' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('type 为空的文件：解码成功就照常压缩', async () => {
    const release = vi.fn();
    const { canvas } = fakeCanvas();
    const blob = await compressFile(file(''), {
      decode: async () => decoded(release),
      makeCanvas: () => canvas,
    });
    expect(blob.type).toBe('image/jpeg');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('type 为空的文件解不出来：提示「不是图片」；type 是 image/* 解不出来仍是「读不出」', async () => {
    const fail = async () => {
      throw new ImageProblem('unreadable');
    };
    await expect(compressFile(file(''), { decode: fail })).rejects.toMatchObject({
      key: 'notImage',
    });
    await expect(compressFile(file('image/heic'), { decode: fail })).rejects.toMatchObject({
      key: 'unreadable',
    });
  });

  it('成功：解码 → 缩放 → JPEG，并释放解码出来的位图', async () => {
    const release = vi.fn();
    const { canvas, draw } = fakeCanvas();
    const blob = await compressFile(file(), {
      decode: async () => decoded(release),
      makeCanvas: () => canvas,
    });
    expect(blob.type).toBe('image/jpeg');
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 1600); // 3000×4000 的竖图
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('编码失败时也要释放位图', async () => {
    const release = vi.fn();
    const failed = fakeCanvas(null);
    await expect(
      compressFile(file(), {
        decode: async () => decoded(release),
        makeCanvas: () => failed.canvas,
      }),
    ).rejects.toMatchObject({ key: 'unreadable' });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('解码失败（HEIC 等读不出）：抛 unreadable', async () => {
    const decode = vi.fn().mockRejectedValue(new ImageProblem('unreadable'));
    await expect(compressFile(file('image/heic'), { decode })).rejects.toMatchObject({
      key: 'unreadable',
    });
  });
});
