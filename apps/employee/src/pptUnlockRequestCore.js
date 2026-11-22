export function createPptUnlockRequestTracker() {
  let generation = 0;
  let activeKey = null;

  return {
    begin(key) {
      const normalizedKey = String(key || "");
      if (!normalizedKey || activeKey === normalizedKey) return null;
      activeKey = normalizedKey;
      return { key: normalizedKey, generation };
    },
    isCurrent(token) {
      return Boolean(token)
        && token.generation === generation
        && token.key === activeKey;
    },
    release(token) {
      if (this.isCurrent(token)) activeKey = null;
    },
    reset() {
      generation += 1;
      activeKey = null;
    }
  };
}

export function canSubmitPptSlideCompletion({
  currentSlide,
  timedSlide,
  imageLoaded,
  imageError,
  timerReady,
  currentUnlocked,
  elapsedMs,
  requiredMs
}) {
  return Number(timedSlide) === Number(currentSlide)
    && Boolean(imageLoaded)
    && !imageError
    && Boolean(timerReady)
    && !currentUnlocked
    && Number(elapsedMs) >= Number(requiredMs);
}
