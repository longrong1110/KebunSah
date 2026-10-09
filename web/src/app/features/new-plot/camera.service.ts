import { Injectable } from '@angular/core';

// 摄像头：打开、手电筒、关闭，以及把各种失败归成几类人话。
// 页面（camera-page）只和 CameraHandle 打交道，测试里可以整个换成假的。

/** 对应词典 camera.errors 里的键 */
export type CameraErrorKey = 'denied' | 'none' | 'busy' | 'insecure' | 'other';

export class CameraError extends Error {
  constructor(readonly key: CameraErrorKey) {
    super(key);
    this.name = 'CameraError';
  }
}

/** 浏览器给的 DOMException 名字 → 我们要给用户说的那一类（不显示原始错误名） */
export function classifyCameraError(err: unknown): CameraErrorKey {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'none';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'other';
  }
}

export interface CameraHandle {
  stream: MediaStream;
  /** 轨道声明支持手电筒才为 true（Android Chrome 有，iOS Safari 与 Firefox 没有） */
  torchSupported: boolean;
  setTorch(on: boolean): Promise<void>;
  /** 停掉所有轨道，摄像头灯随之熄灭 */
  stop(): void;
  /** 轨道被系统结束（被别的应用抢占、拔掉）时回调 */
  onEnded(callback: () => void): void;
}

function makeHandle(stream: MediaStream): CameraHandle {
  const track = stream.getVideoTracks()[0];
  // getCapabilities 本身可能不存在，而且要在轨道就绪后读取
  const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  return {
    stream,
    torchSupported: capabilities.torch === true,
    async setTorch(on) {
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as unknown as MediaTrackConstraints);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
    },
    onEnded(callback) {
      track?.addEventListener('ended', callback);
    },
  };
}

@Injectable({ providedIn: 'root' })
export class CameraService {
  /**
   * 打开摄像头。优先后置；取不到（OverconstrainedError／NotFoundError）就退回任意摄像头再试一次。
   * 失败一律抛 CameraError。getUserMedia 需要安全上下文（localhost 或 HTTPS）：
   * 手机用局域网 IP 的 http 访问时 navigator.mediaDevices 是 undefined，要当成「不能用相机」，不能抛 TypeError。
   */
  async open(): Promise<CameraHandle> {
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!devices?.getUserMedia) throw new CameraError('insecure');

    try {
      return makeHandle(
        await devices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        }),
      );
    } catch (first) {
      if (classifyCameraError(first) !== 'none') throw new CameraError(classifyCameraError(first));
      try {
        return makeHandle(await devices.getUserMedia({ video: true, audio: false }));
      } catch (second) {
        throw new CameraError(classifyCameraError(second));
      }
    }
  }
}
