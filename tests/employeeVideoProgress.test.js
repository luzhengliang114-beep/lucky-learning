const test = require("node:test");
const assert = require("node:assert/strict");

async function videoProgress() {
  return import("../apps/employee/src/videoProgressCore.js");
}

test("first watch can move backward but cannot seek past the watched edge", async () => {
  const { allowedSeekTime } = await videoProgress();

  assert.equal(allowedSeekTime({ targetSeconds: 12, maxWatchedSeconds: 30, completed: false }), 12);
  assert.equal(allowedSeekTime({ targetSeconds: 31, maxWatchedSeconds: 30, completed: false }), 30);
  assert.equal(allowedSeekTime({ targetSeconds: 80, maxWatchedSeconds: 30, completed: true }), 80);
});

test("time updates cannot promote a large seek into watched progress", async () => {
  const { nextMaxWatchedSeconds } = await videoProgress();

  assert.equal(nextMaxWatchedSeconds({ currentSeconds: 20.4, maxWatchedSeconds: 20, completed: false }), 20.4);
  assert.equal(nextMaxWatchedSeconds({ currentSeconds: 50, maxWatchedSeconds: 20, completed: false }), 20);
  assert.equal(nextMaxWatchedSeconds({ currentSeconds: 21, maxWatchedSeconds: 20, completed: false, maxAdvanceSeconds: 0.8 }), 20);
  assert.equal(nextMaxWatchedSeconds({ currentSeconds: 20.6, maxWatchedSeconds: 20, completed: false, maxAdvanceSeconds: 0.8 }), 20.6);
});

test("first watch is fixed to normal speed and completion unlocks speed", async () => {
  const { allowedPlaybackRate } = await videoProgress();

  assert.equal(allowedPlaybackRate(2, false), 1);
  assert.equal(allowedPlaybackRate(1.5, true), 1.5);
});
