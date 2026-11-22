const test = require("node:test");
const assert = require("node:assert/strict");

async function videoCompletion() {
  return import("../apps/employee/src/videoCompletion.js");
}

test("only browser-playable video URLs are accepted", async () => {
  const { playableVideoUrl } = await videoCompletion();

  assert.equal(playableVideoUrl({}), "");
  assert.equal(playableVideoUrl({ videoUrl: "   " }), "");
  assert.equal(playableVideoUrl({ videoUrl: "cloud://env/course.mp4" }), "");
  assert.equal(playableVideoUrl({ videoUrl: " https://example.com/course.mp4 " }), "https://example.com/course.mp4");
  assert.equal(playableVideoUrl({ videoUrl: "blob:https://example.com/video" }), "blob:https://example.com/video");
});

test("course completion requires a playable video and an ended event", async () => {
  const { canCompleteVideoCourse } = await videoCompletion();

  assert.equal(canCompleteVideoCourse({}, true), false);
  assert.equal(canCompleteVideoCourse({ videoUrl: "cloud://env/course.mp4" }, true), false);
  assert.equal(canCompleteVideoCourse({ videoUrl: "https://example.com/course.mp4" }, false), false);
  assert.equal(canCompleteVideoCourse({ videoUrl: "https://example.com/course.mp4" }, true), true);
});
