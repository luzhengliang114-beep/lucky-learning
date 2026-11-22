export interface VideoWatchProgressLike {
  maxWatchedSeconds?: number;
  videoDurationSeconds?: number;
  videoWatchCompleted?: boolean;
  completed?: boolean;
}

export function normalizeVideoWatchProgress(progress?: VideoWatchProgressLike | null): {
  maxWatchedSeconds: number;
  videoDurationSeconds: number;
  videoWatchCompleted: boolean;
};

export function allowedSeekTime(options: {
  targetSeconds: number;
  maxWatchedSeconds: number;
  completed: boolean;
  toleranceSeconds?: number;
}): number;

export function nextMaxWatchedSeconds(options: {
  currentSeconds: number;
  maxWatchedSeconds: number;
  completed: boolean;
  toleranceSeconds?: number;
  maxAdvanceSeconds?: number;
}): number;

export function allowedPlaybackRate(requestedRate: number, completed: boolean): number;
