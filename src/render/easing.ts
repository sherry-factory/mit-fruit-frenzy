export type Ease = (k: number) => number;

export const linear: Ease = (k) => k;
export const easeOutCubic: Ease = (k) => 1 - (1 - k) ** 3;
export const easeInOutCubic: Ease = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

export const easeOutBack: Ease = (k) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2;
};

/** Accelerates like gravity, then settles with one small bounce. */
export const easeDrop: Ease = (k) => {
  if (k < 0.75) return (k / 0.75) ** 2;
  return 1 - 0.07 * Math.sin(((k - 0.75) / 0.25) * Math.PI);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
