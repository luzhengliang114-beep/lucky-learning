const test = require("node:test");
const assert = require("node:assert/strict");

const {
  completePptSlide,
  normalizePptProgress,
  startPptSlide
} = require("../cloudbase/functions/employeeWeb/pptProgressCore");

test("starts only the first unread PPT slide", () => {
  const started = startPptSlide(null, 0, 47, "2026-08-06T09:00:00.000Z");
  assert.equal(started.activeSlide, 0);
  assert.equal(started.unlockedSlides, 0);
  assert.throws(
    () => startPptSlide(started, 2, 47, "2026-08-06T09:00:01.000Z"),
    (error) => error.code === "PPT_SLIDE_LOCKED"
  );
});

test("rejects server completion before the minimum slide duration", () => {
  const started = startPptSlide(null, 0, 47, "2026-08-06T09:00:00.000Z");
  assert.throws(
    () => completePptSlide(started, 0, 47, 3, "2026-08-06T09:00:02.999Z"),
    (error) => error.code === "PPT_SLIDE_TOO_FAST"
  );
});

test("unlocks sequential slides and marks the final slide ready", () => {
  let progress = normalizePptProgress({ unlockedSlides: 46 }, 47);
  progress = startPptSlide(progress, 46, 47, "2026-08-06T09:00:00.000Z");
  progress = completePptSlide(progress, 46, 47, 3, "2026-08-06T09:00:03.100Z");

  assert.equal(progress.unlockedSlides, 47);
  assert.equal(progress.readingCompleted, true);
  assert.equal(progress.progress, 100);
});

test("revisiting an unlocked slide does not reset sequential progress", () => {
  const progress = normalizePptProgress({ unlockedSlides: 4, currentSlide: 4 }, 47);
  const revisited = startPptSlide(progress, 1, 47, "2026-08-06T09:00:00.000Z");

  assert.equal(revisited.unlockedSlides, 4);
  assert.equal(revisited.currentSlide, 1);
  assert.equal(revisited.activeSlide, null);
});
