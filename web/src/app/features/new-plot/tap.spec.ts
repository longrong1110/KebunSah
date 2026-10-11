import { PointerInput, TapTracker, isTap, nearAnyHandle } from './tap';

describe('isTap', () => {
  it('按下抬起离得近、时间短：是点按', () => {
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 103, y: 104, t: 120 })).toBe(true);
  });

  it('位移超过 8 px：是拖动，不是点按（拖地图、拖把手都不放新点）', () => {
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 100, y: 109, t: 100 })).toBe(false);
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 106, y: 106, t: 100 })).toBe(false); // 8.49 px
  });

  it('按住超过 600 ms：是长按，不是点按', () => {
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 601 })).toBe(false);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 600 })).toBe(true);
  });
});

describe('nearAnyHandle', () => {
  const handles = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ];

  it('落在任何一个把手的 24 px 内：是点在把手上', () => {
    expect(nearAnyHandle({ x: 110, y: 110 }, handles)).toBe(true);
    expect(nearAnyHandle({ x: 300, y: 123 }, handles)).toBe(true);
  });

  it('离所有把手都不近：可以放新点', () => {
    expect(nearAnyHandle({ x: 200, y: 100 }, handles)).toBe(false);
    expect(nearAnyHandle({ x: 124, y: 100 }, handles)).toBe(false); // 恰好 24 px 不算
  });

  it('没有把手：永远是新点', () => {
    expect(nearAnyHandle({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('TapTracker', () => {
  const ev = (over: Partial<PointerInput> = {}): PointerInput => ({
    pointerId: 1,
    isPrimary: true,
    button: 0,
    pointerType: 'touch',
    x: 100,
    y: 100,
    t: 0,
    ...over,
  });

  it('单指按下、原地抬起：是点按', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev());
    expect(tracker.pointerUp(ev({ x: 102, y: 101, t: 150 }))).toBe(true);
  });

  it('拖动（位移 >8 px）或长按（>600 ms）：不是点按', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev());
    expect(tracker.pointerUp(ev({ x: 130, t: 100 }))).toBe(false);
    tracker.pointerDown(ev());
    expect(tracker.pointerUp(ev({ t: 700 }))).toBe(false);
  });

  it('连续两下快速点按：两下都算（不像 Google 的 click 会吞第二下）', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev({ t: 0 }));
    expect(tracker.pointerUp(ev({ t: 40 }))).toBe(true);
    tracker.pointerDown(ev({ t: 80, x: 300 }));
    expect(tracker.pointerUp(ev({ t: 120, x: 300 }))).toBe(true);
  });

  it('双指缩放：第二根手指按下后，两根手指抬起都不算点按', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev({ pointerId: 1 }));
    tracker.pointerDown(ev({ pointerId: 2, isPrimary: false, x: 200 }));
    expect(tracker.pointerUp(ev({ pointerId: 2, isPrimary: false, x: 200, t: 50 }))).toBe(false);
    expect(tracker.pointerUp(ev({ pointerId: 1, t: 60 }))).toBe(false);
    // 全部抬起后的下一次单指点按照常有效
    tracker.pointerDown(ev({ t: 200 }));
    expect(tracker.pointerUp(ev({ t: 240 }))).toBe(true);
  });

  it('pointercancel（系统接管手势）：作废这一次', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev());
    tracker.pointerCancel({ pointerId: 1 });
    expect(tracker.pointerUp(ev({ t: 50 }))).toBe(false);
  });

  it('某个 pointerup 丢了（残留的指针 ID）：下一次「第一根手指」按下自愈，点按不会永久失效', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev({ pointerId: 7 })); // 这根手指的 pointerup／cancel 没传到
    tracker.pointerDown(ev({ pointerId: 8, t: 500 })); // 新的一次触摸，isPrimary
    expect(tracker.pointerUp(ev({ pointerId: 8, t: 540 }))).toBe(true);
  });

  it('鼠标右键、中键不算点按；左键算', () => {
    const tracker = new TapTracker();
    tracker.pointerDown(ev({ pointerType: 'mouse', button: 2 }));
    expect(tracker.pointerUp(ev({ pointerType: 'mouse', button: 2, t: 50 }))).toBe(false);
    tracker.pointerDown(ev({ pointerType: 'mouse', button: 0, t: 100 }));
    expect(tracker.pointerUp(ev({ pointerType: 'mouse', button: 0, t: 140 }))).toBe(true);
  });
});
