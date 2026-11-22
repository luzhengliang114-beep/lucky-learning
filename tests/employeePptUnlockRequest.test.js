const test = require("node:test");
const assert = require("node:assert/strict");

async function core() {
  return import("../apps/employee/src/pptUnlockRequestCore.js");
}

test("prevents a state rerender from starting the same PPT unlock request twice", async () => {
  const { createPptUnlockRequestTracker } = await core();
  const tracker = createPptUnlockRequestTracker();
  const first = tracker.begin("course-1:1");

  assert.ok(first);
  assert.equal(tracker.begin("course-1:1"), null);
  assert.equal(tracker.isCurrent(first), true);
});

test("allows retry after a failed PPT unlock request", async () => {
  const { createPptUnlockRequestTracker } = await core();
  const tracker = createPptUnlockRequestTracker();
  const first = tracker.begin("course-1:1");

  tracker.release(first);
  assert.ok(tracker.begin("course-1:1"));
});

test("ignores a PPT unlock response after the course or session changes", async () => {
  const { createPptUnlockRequestTracker } = await core();
  const tracker = createPptUnlockRequestTracker();
  const first = tracker.begin("course-1:1");

  tracker.reset();
  assert.equal(tracker.isCurrent(first), false);
  assert.ok(tracker.begin("course-2:0"));
});

test("does not submit completion with the previous slide timer after navigation", async () => {
  const { canSubmitPptSlideCompletion } = await core();
  const base = {
    currentSlide: 3,
    imageLoaded: true,
    imageError: false,
    timerReady: true,
    currentUnlocked: false,
    elapsedMs: 3000,
    requiredMs: 3000
  };

  assert.equal(canSubmitPptSlideCompletion({ ...base, timedSlide: 2 }), false);
  assert.equal(canSubmitPptSlideCompletion({ ...base, timedSlide: 3 }), true);
});
