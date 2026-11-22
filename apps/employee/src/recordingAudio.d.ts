export function encodeMonoWav(samples: Float32Array, sampleRate?: number): Blob;
export function convertRecordingToWav(recording: Blob, targetSampleRate?: number): Promise<Blob>;
