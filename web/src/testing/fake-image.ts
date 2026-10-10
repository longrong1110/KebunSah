import { vi } from 'vitest';

// 组件测试用的"图像管线替身"：jsdom 没有 canvas、createImageBitmap、createObjectURL。
// 这里只把浏览器 API 换成假的，image.ts 里的真实逻辑（缩放、编码、释放）照常运行。

let counter = 0;

export interface ImagePipelineStub {
  /** createObjectURL 发出过的地址 */
  created: string[];
  /** revokeObjectURL 收到的地址 */
  revoked: string[];
  /** canvas.drawImage 的调用 */
  draw: ReturnType<typeof vi.fn>;
  /** canvas.toBlob 被调用的次数 */
  encodes: () => number;
  /** createImageBitmap 返回的位图，close 被调用的次数 */
  bitmapsClosed: () => number;
  /** 让下一次编码失败（toBlob 回调 null） */
  failNextEncode(): void;
  restore(): void;
}

export function stubImagePipeline(size = { width: 3000, height: 4000 }): ImagePipelineStub {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  let closed = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ ...size, close: () => closed++ })),
  );

  const draw = vi.fn();
  let encodes = 0;
  let failNext = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: draw,
  })) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: BlobCallback) => {
    encodes++;
    if (failNext) {
      failNext = false;
      cb(null);
    } else {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    }
  }) as never);

  return {
    created,
    revoked,
    draw,
    encodes: () => encodes,
    bitmapsClosed: () => closed,
    failNextEncode: () => (failNext = true),
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

/** 往 <input type=file> 里塞一个文件并触发 change（jsdom 不允许直接给 files 赋值） */
export function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

export const imageFile = (name = 'a.jpg', type = 'image/jpeg') => new File(['x'], name, { type });
