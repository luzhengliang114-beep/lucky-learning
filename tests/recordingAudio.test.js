const test = require("node:test");
const assert = require("node:assert/strict");
const { wavDurationSeconds } = require("../cloudbase/functions/employeeWeb/core");

test("WAV encoder creates a mono 16-bit PCM header and clamps samples", async () => {
  const { encodeMonoWav } = await import("../apps/employee/src/recordingAudio.js");
  const blob = encodeMonoWav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 16000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(blob.type, "audio/wav");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(52, true), 32767);
  assert.equal(wavDurationSeconds(Buffer.from(bytes)), 5 / 16000);
});
