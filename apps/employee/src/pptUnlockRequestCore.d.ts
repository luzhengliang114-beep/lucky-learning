export type PptUnlockRequestToken = { key: string; generation: number };

export type PptUnlockRequestTracker = {
  begin(key: string): PptUnlockRequestToken | null;
  isCurrent(token: PptUnlockRequestToken | null): boolean;
  release(token: PptUnlockRequestToken | null): void;
  reset(): void;
};

export function createPptUnlockRequestTracker(): PptUnlockRequestTracker;

export function canSubmitPptSlideCompletion(input: {
  currentSlide: number;
  timedSlide: number | null;
  imageLoaded: boolean;
  imageError: boolean;
  timerReady: boolean;
  currentUnlocked: boolean;
  elapsedMs: number;
  requiredMs: number;
}): boolean;
