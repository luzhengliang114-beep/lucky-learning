export function clampMediaScale(value, minimum = 1, maximum = 4) {
  const scale = Number(value);
  const min = Number.isFinite(Number(minimum)) ? Number(minimum) : 1;
  const max = Math.max(min, Number.isFinite(Number(maximum)) ? Number(maximum) : 4);
  return Math.min(max, Math.max(min, Number.isFinite(scale) ? scale : min));
}

export function pinchMediaScale({ startScale, startDistance, currentDistance, minimum = 1, maximum = 4 }) {
  const distance = Math.max(0, Number(currentDistance) || 0);
  const initialDistance = Math.max(0, Number(startDistance) || 0);
  if (initialDistance <= 0) return clampMediaScale(startScale, minimum, maximum);
  return clampMediaScale((Number(startScale) || minimum) * distance / initialDistance, minimum, maximum);
}

export function panMediaOffset({ startOffset, startPoint, currentPoint, scale }) {
  if (clampMediaScale(scale) <= 1) return { x: 0, y: 0 };
  return {
    x: (Number(startOffset?.x) || 0) + (Number(currentPoint?.x) || 0) - (Number(startPoint?.x) || 0),
    y: (Number(startOffset?.y) || 0) + (Number(currentPoint?.y) || 0) - (Number(startPoint?.y) || 0)
  };
}

export function normalizeMediaRotation(value) {
  const angle = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  return ((angle % 360) + 360) % 360;
}

export function fitMediaScale({ stageWidth, stageHeight, mediaWidth, mediaHeight, rotation = 0, fit = "contain", minimum = 0.1, maximum = 4 }) {
  const stageW = Math.max(0, Number(stageWidth) || 0);
  const stageH = Math.max(0, Number(stageHeight) || 0);
  const width = Math.max(0, Number(mediaWidth) || 0);
  const height = Math.max(0, Number(mediaHeight) || 0);
  if (!(stageW > 0 && stageH > 0 && width > 0 && height > 0)) return 1;
  const normalizedRotation = normalizeMediaRotation(rotation);
  const rotatedWidth = normalizedRotation % 180 === 0 ? width : height;
  const rotatedHeight = normalizedRotation % 180 === 0 ? height : width;
  const scale = fit === "cover"
    ? Math.max(stageW / rotatedWidth, stageH / rotatedHeight)
    : Math.min(stageW / rotatedWidth, stageH / rotatedHeight);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(scale) ? scale : 1));
}

export function mediaBoxSize({ mediaWidth, mediaHeight, rotation = 0, scale = 1 }) {
  const width = Math.max(0, Number(mediaWidth) || 0);
  const height = Math.max(0, Number(mediaHeight) || 0);
  const normalizedRotation = normalizeMediaRotation(rotation);
  const rotatedWidth = normalizedRotation % 180 === 0 ? width : height;
  const rotatedHeight = normalizedRotation % 180 === 0 ? height : width;
  const factor = Math.max(0, Number(scale) || 0);
  return {
    width: rotatedWidth * factor,
    height: rotatedHeight * factor
  };
}

export function mediaFrameSizes({ mediaWidth, mediaHeight, rotation = 0, scale = 1 }) {
  const width = Math.max(0, Number(mediaWidth) || 0);
  const height = Math.max(0, Number(mediaHeight) || 0);
  const factor = Math.max(0, Number(scale) || 0);
  const normalizedRotation = normalizeMediaRotation(rotation);
  const contentWidth = width * factor;
  const contentHeight = height * factor;
  return normalizedRotation % 180 === 0
    ? {
        frameWidth: contentWidth,
        frameHeight: contentHeight,
        contentWidth,
        contentHeight
      }
    : {
        frameWidth: contentHeight,
        frameHeight: contentWidth,
        contentWidth,
        contentHeight
      };
}
