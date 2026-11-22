function clampInteger(value, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

export function normalizePptProgress(raw, slideCount) {
  const count = Math.max(1, Math.trunc(Number(slideCount) || 1));
  const unlockedSlides = clampInteger(raw?.unlockedSlides, 0, count);
  const currentSlide = clampInteger(raw?.currentSlide, 0, Math.min(unlockedSlides, count - 1));
  return {
    slideCount: count,
    currentSlide,
    unlockedSlides,
    completed: unlockedSlides >= count
  };
}

export function readonlyPptProgress(slideCount) {
  const count = Math.max(1, Math.trunc(Number(slideCount) || 1));
  return {
    slideCount: count,
    currentSlide: 0,
    unlockedSlides: count,
    completed: true
  };
}

export function moveToPptSlide(progress, targetSlide) {
  const normalized = normalizePptProgress(progress, progress?.slideCount);
  const target = clampInteger(targetSlide, 0, normalized.slideCount - 1);
  if (target > normalized.unlockedSlides) {
    throw new Error("尚未完成前一页，不能跳过学习");
  }
  return { ...normalized, currentSlide: target };
}

export function unlockCurrentPptSlide(progress, elapsedMs, minSeconds) {
  const normalized = normalizePptProgress(progress, progress?.slideCount);
  const requiredMs = Math.max(0, Number(minSeconds) || 0) * 1000;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);

  if (normalized.currentSlide < normalized.unlockedSlides) {
    return { progress: normalized, unlocked: true, remainingMs: 0, reward: 0 };
  }

  const remainingMs = Math.max(0, requiredMs - elapsed);
  if (remainingMs > 0) {
    return { progress, unlocked: false, remainingMs };
  }

  const unlockedSlides = Math.min(normalized.slideCount, normalized.unlockedSlides + 1);
  return {
    progress: {
      ...normalized,
      unlockedSlides,
      completed: unlockedSlides >= normalized.slideCount
    },
    unlocked: true,
    remainingMs: 0,
    reward: 0
  };
}

export function pptSlideImageUrl(course, slideIndex) {
  const urls = Array.isArray(course?.slideImageUrls) ? course.slideImageUrls : [];
  const directUrl = String(urls[Math.max(0, Number(slideIndex) || 0)] || "").trim();
  if (directUrl) return directUrl;
  const prefix = String(course?.slideImagePrefix || "").trim();
  if (!prefix) return "";
  const page = String(Math.max(0, Number(slideIndex) || 0) + 1).padStart(3, "0");
  const separator = prefix.includes("?") ? "&" : "?";
  return `${prefix}${page}.webp${separator}v=ppt-20260820`;
}
