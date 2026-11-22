const test = require("node:test");
const assert = require("node:assert/strict");

async function mediaView() {
  return import("../apps/employee/src/mediaViewCore.js");
}

test("PPT viewer zoom stays within the supported range", async () => {
  const { clampMediaScale, pinchMediaScale } = await mediaView();

  assert.equal(clampMediaScale(0.5), 1);
  assert.equal(clampMediaScale(5), 4);
  assert.equal(pinchMediaScale({ startScale: 1, startDistance: 100, currentDistance: 250 }), 2.5);
  assert.equal(pinchMediaScale({ startScale: 3, startDistance: 100, currentDistance: 200 }), 4);
});

test("PPT viewer only pans while the page is enlarged", async () => {
  const { panMediaOffset } = await mediaView();

  assert.deepEqual(panMediaOffset({
    startOffset: { x: 40, y: -10 },
    startPoint: { x: 100, y: 100 },
    currentPoint: { x: 130, y: 80 },
    scale: 1
  }), { x: 0, y: 0 });

  assert.deepEqual(panMediaOffset({
    startOffset: { x: 40, y: -10 },
    startPoint: { x: 100, y: 100 },
    currentPoint: { x: 130, y: 80 },
    scale: 2
  }), { x: 70, y: -30 });
});

test("media rotation normalizes to right-angle viewer states", async () => {
  const { fitMediaScale, mediaFrameSizes, normalizeMediaRotation } = await mediaView();

  assert.equal(normalizeMediaRotation(0), 0);
  assert.equal(normalizeMediaRotation(90), 90);
  assert.equal(normalizeMediaRotation(360), 0);
  assert.equal(normalizeMediaRotation(450), 90);
  assert.equal(normalizeMediaRotation(-90), 270);
  assert.equal(fitMediaScale({ stageWidth: 1000, stageHeight: 500, mediaWidth: 1280, mediaHeight: 720, rotation: 0 }).toFixed(3), "0.694");
  assert.equal(fitMediaScale({ stageWidth: 1000, stageHeight: 500, mediaWidth: 1280, mediaHeight: 720, rotation: 90 }).toFixed(3), "0.391");
  assert.equal(fitMediaScale({ stageWidth: 1000, stageHeight: 500, mediaWidth: 1280, mediaHeight: 720, rotation: 90, fit: "cover" }).toFixed(3), "1.389");
  assert.equal(fitMediaScale({ stageWidth: 1000, stageHeight: 500, mediaWidth: 160, mediaHeight: 90, fit: "cover", maximum: 100 }).toFixed(3), "6.250");
  assert.deepEqual(mediaFrameSizes({ mediaWidth: 1280, mediaHeight: 720, rotation: 0, scale: 1 }), {
    frameWidth: 1280,
    frameHeight: 720,
    contentWidth: 1280,
    contentHeight: 720
  });
  assert.deepEqual(mediaFrameSizes({ mediaWidth: 1280, mediaHeight: 720, rotation: 90, scale: 1 }), {
    frameWidth: 720,
    frameHeight: 1280,
    contentWidth: 1280,
    contentHeight: 720
  });
});

test("fullscreen viewing does not change video seek or PPT unlock rules", async () => {
  const [{ allowedSeekTime }, { moveToPptSlide }] = await Promise.all([
    import("../apps/employee/src/videoProgressCore.js"),
    import("../apps/employee/src/pptProgressCore.js")
  ]);

  assert.equal(allowedSeekTime({ targetSeconds: 50, maxWatchedSeconds: 12, completed: false }), 12);
  assert.throws(() => moveToPptSlide({
    slideCount: 10,
    currentSlide: 0,
    unlockedSlides: 0,
    completed: false
  }, 1), /不能跳过学习/);
});

test("supplier read-only PPT access unlocks every page without creating progress", async () => {
  const { readonlyPptProgress, moveToPptSlide } = await import("../apps/employee/src/pptProgressCore.js");
  const progress = readonlyPptProgress(43);
  assert.deepEqual(progress, { slideCount: 43, currentSlide: 0, unlockedSlides: 43, completed: true });
  assert.equal(moveToPptSlide(progress, 42).currentSlide, 42);
});
