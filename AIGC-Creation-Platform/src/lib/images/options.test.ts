import { describe, expect, it } from 'vitest';
import { aspectOf, IMAGE_RESOLUTIONS, RESOLUTION_LONG_EDGE, sizeFromAspectResolution } from './options';

// aspectOf 是预览框与作品详情里"像素 → 画幅"的唯一换算：约分错了显示就会和实际像素对不上。
describe('aspectOf —— 像素约分成画幅', () => {
  const cases: [string, string][] = [
    ['1024x1024', '1:1'],
    ['1536x1024', '3:2'],
    ['1024x1536', '2:3'],
    ['1536x864', '16:9'],
    ['864x1536', '9:16'],
    ['2048x1152', '16:9'],
    ['3840x2160', '16:9'],
    ['2160x3840', '9:16'],
    // 前后空白要容忍
    [' 1536x864 ', '16:9'],
  ];
  for (const [size, ratio] of cases) {
    it(`${size} → ${ratio}`, () => {
      expect(aspectOf(size)).toBe(ratio);
    });
  }

  // auto / 空 / 非法值没有画幅，返回空串让界面显示占位而不是崩
  for (const bad of ['auto', '', '1024', 'axb', '0x100', '100x0', '-1x100']) {
    it(`无画幅 ${JSON.stringify(bad)} → ''`, () => {
      expect(aspectOf(bad)).toBe('');
    });
  }
});

// 分辨率档位 × 画幅 → 像素。16:9 下必须落在大家熟悉的标准分辨率上，
// 这是"480p/720p/1K/2K/4K 到底是多少像素"的对外承诺，钉死防止换算漂移。
describe('sizeFromAspectResolution —— 16:9 落在标准分辨率', () => {
  const cases: [string, string][] = [
    ['480p', '848x480'],
    ['720p', '1280x720'],
    ['1K', '1024x576'],
    ['1.5K', '1536x864'],
    ['2K', '2048x1152'],
    ['2.5K', '2560x1440'],
    ['4K', '3840x2160'],
  ];
  for (const [tier, pixels] of cases) {
    it(`16:9 + ${tier} → ${pixels}`, () => {
      expect(sizeFromAspectResolution('16:9', tier)).toBe(pixels);
    });
  }
});

describe('sizeFromAspectResolution —— 竖版与方形', () => {
  it('竖版长边是高', () => {
    expect(sizeFromAspectResolution('9:16', '4K')).toBe('2160x3840');
    expect(sizeFromAspectResolution('9:16', '1.5K')).toBe('864x1536');
  });
  it('方形两边都等于档位长边', () => {
    expect(sizeFromAspectResolution('1:1', '1K')).toBe('1024x1024');
    expect(sizeFromAspectResolution('1:1', '2K')).toBe('2048x2048');
  });
  it('非法画幅或档位返回空串', () => {
    expect(sizeFromAspectResolution('', '2K')).toBe('');
    expect(sizeFromAspectResolution('16:9', '')).toBe('');
    expect(sizeFromAspectResolution('abc', '2K')).toBe('');
    expect(sizeFromAspectResolution('16:9', '8K')).toBe('');
  });
});

// gpt-image 系列要求宽高都是 16 的倍数且不超过 3840：任意档位 × 任意画幅都必须满足，
// 否则发出去会被供应商直接拒。这条不变量扫全组合。
describe('sizeFromAspectResolution —— 输出恒为 16 倍数且不超上限', () => {
  const aspects = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '2:1', '1:2'];
  it('所有组合宽高都是 16 的倍数且 ≤ 3840', () => {
    for (const tier of IMAGE_RESOLUTIONS) {
      for (const a of aspects) {
        const [w, h] = sizeFromAspectResolution(a, tier).split('x').map(Number);
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(w).toBeLessThanOrEqual(3840);
        expect(h).toBeLessThanOrEqual(3840);
        expect(w).toBeGreaterThanOrEqual(16);
        expect(h).toBeGreaterThanOrEqual(16);
      }
    }
  });
  it('换算后形状接近所选画幅（16 取整带来的误差 < 3%）', () => {
    for (const tier of IMAGE_RESOLUTIONS) {
      for (const a of aspects) {
        const [aw, ah] = a.split(':').map(Number);
        const [w, h] = sizeFromAspectResolution(a, tier).split('x').map(Number);
        expect(Math.abs(w / h - aw / ah) / (aw / ah)).toBeLessThan(0.03);
      }
    }
  });
});

// 档位长边必须单调递增（480p 最小、4K 最大），否则下拉顺序会误导用户。
// 注意 p 档与 K 档混排时 1K(1024) 略小于 720p(1280) 是已知取舍，这里只钉住两端与 K 档内部单调。
describe('RESOLUTION_LONG_EDGE —— 档位长边', () => {
  it('K 档内部单调递增', () => {
    const k = ['1K', '1.5K', '2K', '2.5K', '4K'] as const;
    for (let i = 1; i < k.length; i++) {
      expect(RESOLUTION_LONG_EDGE[k[i]]).toBeGreaterThan(RESOLUTION_LONG_EDGE[k[i - 1]]);
    }
  });
  it('480p 最小、4K 最大', () => {
    const vals = IMAGE_RESOLUTIONS.map((t) => RESOLUTION_LONG_EDGE[t]);
    expect(RESOLUTION_LONG_EDGE['480p']).toBe(Math.min(...vals));
    expect(RESOLUTION_LONG_EDGE['4K']).toBe(Math.max(...vals));
  });
});