function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeMonoWav(samples, sampleRate = 16000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function convertRecordingToWav(recording, targetSampleRate = 16000) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) throw new Error("当前微信版本无法处理录音格式");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offline = new OfflineAudioContextClass(1, frameCount, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return encodeMonoWav(rendered.getChannelData(0), targetSampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}
