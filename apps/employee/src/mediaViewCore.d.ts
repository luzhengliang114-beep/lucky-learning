export type MediaPoint = { x: number; y: number };

export function clampMediaScale(value: number, minimum?: number, maximum?: number): number;
export function pinchMediaScale(input: {
  startScale: number;
  startDistance: number;
  currentDistance: number;
  minimum?: number;
  maximum?: number;
}): number;
export function panMediaOffset(input: {
  startOffset: MediaPoint;
  startPoint: MediaPoint;
  currentPoint: MediaPoint;
  scale: number;
}): MediaPoint;
export function normalizeMediaRotation(value: number): number;
export function fitMediaScale(input: {
  stageWidth: number;
  stageHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  rotation?: number;
  fit?: "contain" | "cover";
  minimum?: number;
  maximum?: number;
}): number;
export function mediaBoxSize(input: {
  mediaWidth: number;
  mediaHeight: number;
  rotation?: number;
  scale?: number;
}): MediaPoint;
export function mediaFrameSizes(input: {
  mediaWidth: number;
  mediaHeight: number;
  rotation?: number;
  scale?: number;
}): {
  frameWidth: number;
  frameHeight: number;
  contentWidth: number;
  contentHeight: number;
};
