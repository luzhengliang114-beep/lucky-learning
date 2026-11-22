export interface PptProgress {
  slideCount: number;
  currentSlide: number;
  unlockedSlides: number;
  completed: boolean;
}

export function normalizePptProgress(raw: Partial<PptProgress> | null | undefined, slideCount: number): PptProgress;
export function readonlyPptProgress(slideCount: number): PptProgress;
export function moveToPptSlide(progress: PptProgress, targetSlide: number): PptProgress;
export function unlockCurrentPptSlide(progress: PptProgress, elapsedMs: number, minSeconds: number): {
  progress: PptProgress;
  unlocked: boolean;
  remainingMs: number;
  reward?: number;
};
export function pptSlideImageUrl(course: { slideImagePrefix?: string; slideImageUrls?: string[] }, slideIndex: number): string;
