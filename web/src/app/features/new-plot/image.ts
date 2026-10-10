// 拍下／选来的照片 → 压缩后的 JPEG。屏 3 的相册入口与屏 4 的取景、相册选图共用。
//
// 规格（spec C7）：
//   - image/jpeg，长边 ≤ MAX_LONG_SIDE，小图不放大，宽高比不变；
//   - 方向按 EXIF 摆正（竖拍的相册照不能横躺）；
//   - 重新绘制到 canvas 再编码，所以输出不含 EXIF／GPS；
//   - 保存整帧，不按取景框裁切。
// 长边与质量是单一常量：1600px 对地契上的小字做 OCR 可能偏小（A4 约 135dpi），屏 8 读字段前很可能要调大。

export const MAX_LONG_SIDE = 1600;
export const JPEG_QUALITY = 0.85;
/** 相册里选的文件超过这个大小就拒绝：48MP 的照片解码后要占几百 MB 内存，低端机会崩 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 对应词典 camera.errors 里的键 */
export type ImageProblemKey = 'notImage' | 'tooBig' | 'unreadable';

export class ImageProblem extends Error {
  constructor(readonly key: ImageProblemKey) {
    super(key);
    this.name = 'ImageProblem';
  }
}

/** 缩到长边 ≤ maxLong，保持宽高比；已经够小的不放大 */
export function fitWithin(width: number, height: number, maxLong = MAX_LONG_SIDE) {
  const long = Math.max(width, height);
  if (long <= maxLong) return { width, height };
  const scale = maxLong / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 选来的文件是否能处理：必须是图片，且不能太大。通过返回 null，否则返回问题键 */
export function checkFile(file: { type: string; size: number }): ImageProblemKey | null {
  if (!file.type.startsWith('image/')) return 'notImage';
  if (file.size > MAX_FILE_BYTES) return 'tooBig';
  return null;
}

/** 只声明用到的那一点 canvas 接口，测试里可以换成假的 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): {
    drawImage(source: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  } | null;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

const defaultCanvas = (): CanvasLike => document.createElement('canvas') as CanvasLike;

/** 把一个图像源（视频帧或位图）缩放后编码成 JPEG。用完把 canvas 尺寸置 0，尽快释放内存 */
export async function renderJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  makeCanvas: () => CanvasLike = defaultCanvas,
): Promise<Blob> {
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new ImageProblem('unreadable');
  const { width, height } = fitWithin(sourceWidth, sourceHeight);
  const canvas = makeCanvas();
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageProblem('unreadable');
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new ImageProblem('unreadable');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

/** 解码文件：优先 createImageBitmap（可指定按 EXIF 摆正）；不支持就退回 <img>（浏览器画 <img> 时默认已按 EXIF 摆正） */
export async function decodeFile(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 老浏览器不认选项，或这个格式解不出来：下面再试 <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => undefined,
    };
  } catch {
    throw new ImageProblem('unreadable');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 相册里选的文件 → 压缩后的 JPEG；文件不对、太大、读不出都抛 ImageProblem */
export async function compressFile(
  file: File,
  deps: { decode?: typeof decodeFile; makeCanvas?: () => CanvasLike } = {},
): Promise<Blob> {
  const problem = checkFile(file);
  if (problem) throw new ImageProblem(problem);
  const decoded = await (deps.decode ?? decodeFile)(file);
  try {
    return await renderJpeg(decoded.source, decoded.width, decoded.height, deps.makeCanvas);
  } finally {
    decoded.release();
  }
}
