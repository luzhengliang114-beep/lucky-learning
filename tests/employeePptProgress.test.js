const test = require("node:test");
const assert = require("node:assert/strict");

async function core() {
  return import("../apps/employee/src/pptProgressCore.js");
}

test("normalizes persisted progress and resumes the first unread slide", async () => {
  const { normalizePptProgress } = await core();

  assert.deepEqual(normalizePptProgress(null, 47), {
    slideCount: 47,
    currentSlide: 0,
    unlockedSlides: 0,
    completed: false
  });

  assert.deepEqual(normalizePptProgress({ currentSlide: 30, unlockedSlides: 12 }, 47), {
    slideCount: 47,
    currentSlide: 12,
    unlockedSlides: 12,
    completed: false
  });
});

test("does not unlock a new slide before three visible seconds", async () => {
  const { unlockCurrentPptSlide } = await core();
  const progress = { slideCount: 47, currentSlide: 0, unlockedSlides: 0, completed: false };

  assert.deepEqual(unlockCurrentPptSlide(progress, 2999, 3), {
    progress,
    unlocked: false,
    remainingMs: 1
  });
});

test("unlocks slides in order and allows revisiting completed slides", async () => {
  const { moveToPptSlide, unlockCurrentPptSlide } = await core();
  const initial = { slideCount: 47, currentSlide: 0, unlockedSlides: 0, completed: false };
  const first = unlockCurrentPptSlide(initial, 3000, 3);

  assert.equal(first.unlocked, true);
  assert.equal(first.progress.unlockedSlides, 1);
  assert.equal(moveToPptSlide(first.progress, 1).currentSlide, 1);
  assert.equal(moveToPptSlide({ ...first.progress, currentSlide: 1 }, 0).currentSlide, 0);
  assert.throws(() => moveToPptSlide(first.progress, 2), /尚未完成前一页/);
});

test("the last page unlock marks reading complete without creating a reward", async () => {
  const { unlockCurrentPptSlide } = await core();
  const progress = { slideCount: 47, currentSlide: 46, unlockedSlides: 46, completed: false };
  const result = unlockCurrentPptSlide(progress, 3100, 3);

  assert.equal(result.progress.unlockedSlides, 47);
  assert.equal(result.progress.completed, true);
  assert.equal(result.reward, 0);
});

test("builds three-digit slide image paths", async () => {
  const { pptSlideImageUrl } = await core();

  assert.equal(
    pptSlideImageUrl({ slideImagePrefix: "ppt/demo/page-" }, 0),
    "ppt/demo/page-001.webp?v=ppt-20260820"
  );
  assert.equal(
    pptSlideImageUrl({ slideImagePrefix: "/employee/ppt/demo/page-" }, 46),
    "/employee/ppt/demo/page-047.webp?v=ppt-20260820"
  );
  assert.equal(
    pptSlideImageUrl({ slideImageUrls: ["https://example.com/page-1.jpg"] }, 0),
    "https://example.com/page-1.jpg"
  );
});
