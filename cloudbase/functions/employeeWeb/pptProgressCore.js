function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function clamp(value, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(unlockedSlides, slideCount) {
  return Math.round(unlockedSlides / slideCount * 100);
}

function normalizePptProgress(record, slideCount) {
  const count = Math.max(1, Math.trunc(Number(slideCount) || 1));
  const unlockedSlides = clamp(record?.unlockedSlides, 0, count);
  const currentSlide = clamp(record?.currentSlide, 0, Math.min(unlockedSlides, count - 1));
  return {
    ...(record || {}),
    slideCount: count,
    currentSlide,
    unlockedSlides,
    activeSlide: Number.isInteger(record?.activeSlide) ? record.activeSlide : null,
    slideStartedAt: record?.slideStartedAt || "",
    readingCompleted: unlockedSlides >= count,
    progress: percent(unlockedSlides, count)
  };
}

function startPptSlide(record, slideIndex, slideCount, startedAt) {
  const progress = normalizePptProgress(record, slideCount);
  const target = clamp(slideIndex, 0, progress.slideCount - 1);
  if (target > progress.unlockedSlides) {
    fail("请先完成前一页再继续", "PPT_SLIDE_LOCKED");
  }
  if (target < progress.unlockedSlides) {
    return { ...progress, currentSlide: target, activeSlide: null, slideStartedAt: "" };
  }
  return {
    ...progress,
    currentSlide: target,
    activeSlide: target,
    slideStartedAt: startedAt
  };
}

function completePptSlide(record, slideIndex, slideCount, minSeconds, completedAt) {
  const progress = normalizePptProgress(record, slideCount);
  const target = clamp(slideIndex, 0, progress.slideCount - 1);
  if (target < progress.unlockedSlides) return progress;
  if (target !== progress.unlockedSlides || progress.activeSlide !== target) {
    fail("本页尚未开始计时", "PPT_SLIDE_NOT_STARTED");
  }
  const elapsedMs = timestamp(completedAt) - timestamp(progress.slideStartedAt);
  const requiredMs = Math.max(1, Number(minSeconds) || 3) * 1000;
  if (!timestamp(progress.slideStartedAt) || elapsedMs < requiredMs) {
    fail("本页学习时间不足，请继续查看", "PPT_SLIDE_TOO_FAST");
  }
  return normalizePptProgress({
    ...progress,
    currentSlide: target,
    unlockedSlides: target + 1,
    activeSlide: null,
    slideStartedAt: ""
  }, progress.slideCount);
}

module.exports = {
  completePptSlide,
  normalizePptProgress,
  startPptSlide
};
