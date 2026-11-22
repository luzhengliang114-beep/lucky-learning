import React from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import {
  queuePendingVideoWatchProgress,
  syncVideoWatchProgress,
  type EmployeeAppData,
  type EmployeeSession,
  type VideoWatchProgress
} from "../data";
import {
  allowedPlaybackRate,
  allowedSeekTime,
  nextMaxWatchedSeconds,
  normalizeVideoWatchProgress
} from "../videoProgressCore.js";

type AppCourse = EmployeeAppData["courses"][number];

function formatVideoTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function RestrictedVideoPlayer({
  course,
  employeeId,
  session,
  dataSource,
  readOnly = false,
  src,
  poster,
  onWatched,
  onError,
  flushProgressRef
}: {
  course: AppCourse;
  employeeId: string;
  session: EmployeeSession | null;
  dataSource: EmployeeAppData["source"];
  readOnly?: boolean;
  src: string;
  poster?: string;
  onWatched: () => void;
  onError: (message: string) => void;
  flushProgressRef: React.MutableRefObject<() => Promise<unknown>>;
}) {
  const initialProgress = normalizeVideoWatchProgress({
    ...(course.videoProgress || {}),
    completed: course.completed
  }) as VideoWatchProgress;
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mountedRef = React.useRef(true);
  const maximumRef = React.useRef(initialProgress.maxWatchedSeconds);
  const durationRef = React.useRef(initialProgress.videoDurationSeconds);
  const completedRef = React.useRef(initialProgress.videoWatchCompleted);
  const lastSubmittedRef = React.useRef(initialProgress.maxWatchedSeconds);
  const pendingEndedRef = React.useRef(false);
  const pendingKeepaliveRef = React.useRef(false);
  const syncPromiseRef = React.useRef<Promise<VideoWatchProgress | null> | null>(null);
  const seekCeilingRef = React.useRef<number | null>(null);
  const activeSeekGestureRef = React.useRef(false);
  const resumeAfterControlSeekRef = React.useRef(false);
  const correctingSeekRef = React.useRef(false);
  const lastBlockedNoticeRef = React.useRef(0);
  const lastSyncNoticeRef = React.useRef(0);
  const playbackAnchorRef = React.useRef<{ maximumAtStart: number; startedAt: number } | null>(null);
  const onWatchedRef = React.useRef(onWatched);
  const onErrorRef = React.useRef(onError);
  const [maxWatchedSeconds, setMaxWatchedSeconds] = React.useState(initialProgress.maxWatchedSeconds);
  const [durationSeconds, setDurationSeconds] = React.useState(initialProgress.videoDurationSeconds);
  const [completed, setCompleted] = React.useState(initialProgress.videoWatchCompleted);
  const [syncing, setSyncing] = React.useState(false);
  const [currentSeconds, setCurrentSeconds] = React.useState(0);
  const [paused, setPaused] = React.useState(true);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [expanded, setExpanded] = React.useState(false);
  const isCloud = dataSource === "cloudbase" && Boolean(session) && !readOnly;

  React.useEffect(() => {
    onWatchedRef.current = onWatched;
    onErrorRef.current = onError;
  }, [onError, onWatched]);

  React.useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (!expanded) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const syncNow = React.useCallback((ended = false, keepalive = false) => {
    if (completedRef.current) {
      if (ended) onWatchedRef.current();
      return Promise.resolve(normalizeVideoWatchProgress({
        maxWatchedSeconds: maximumRef.current,
        videoDurationSeconds: durationRef.current,
        videoWatchCompleted: true
      }) as VideoWatchProgress);
    }
    if (!isCloud || !session) {
      if (ended) {
        completedRef.current = true;
        setCompleted(true);
        onWatchedRef.current();
      }
      return Promise.resolve(null);
    }

    pendingEndedRef.current = pendingEndedRef.current || ended;
    pendingKeepaliveRef.current = pendingKeepaliveRef.current || keepalive;
    if (durationRef.current > 0) {
      queuePendingVideoWatchProgress(employeeId, course.id, {
        maxWatchedSeconds: maximumRef.current,
        videoDurationSeconds: durationRef.current,
        ended: pendingEndedRef.current
      });
    }
    if (syncPromiseRef.current) return syncPromiseRef.current;

    const run = async () => {
      setSyncing(true);
      while (pendingEndedRef.current || maximumRef.current > lastSubmittedRef.current + 0.1) {
        const reportEnded = pendingEndedRef.current;
        const reportKeepalive = pendingKeepaliveRef.current;
        pendingEndedRef.current = false;
        pendingKeepaliveRef.current = false;
        const maximum = maximumRef.current;
        const duration = durationRef.current;
        if (!(duration > 0)) {
          pendingEndedRef.current = pendingEndedRef.current || reportEnded;
          return null;
        }
        try {
          const remote = await syncVideoWatchProgress(session, course.id, {
            maxWatchedSeconds: maximum,
            videoDurationSeconds: duration,
            ended: reportEnded
          }, { employeeId, keepalive: reportKeepalive });
          const normalized = normalizeVideoWatchProgress(remote) as VideoWatchProgress;
          maximumRef.current = Math.max(maximumRef.current, normalized.maxWatchedSeconds);
          durationRef.current = normalized.videoDurationSeconds || durationRef.current;
          completedRef.current = normalized.videoWatchCompleted;
          lastSubmittedRef.current = Math.max(lastSubmittedRef.current, normalized.maxWatchedSeconds);
          if (mountedRef.current) {
            setMaxWatchedSeconds(maximumRef.current);
            setDurationSeconds(durationRef.current);
            setCompleted(completedRef.current);
          }
          if (normalized.videoWatchCompleted) onWatchedRef.current();
        } catch (error) {
          pendingEndedRef.current = pendingEndedRef.current || reportEnded;
          const now = Date.now();
          if (now - lastSyncNoticeRef.current > 10000) {
            lastSyncNoticeRef.current = now;
            onErrorRef.current(error instanceof Error ? error.message : "视频学习进度同步失败，请检查网络");
          }
          return null;
        }
      }
      return normalizeVideoWatchProgress({
        maxWatchedSeconds: maximumRef.current,
        videoDurationSeconds: durationRef.current,
        videoWatchCompleted: completedRef.current
      }) as VideoWatchProgress;
    };

    const promise = run().finally(() => {
      syncPromiseRef.current = null;
      if (mountedRef.current) setSyncing(false);
    });
    syncPromiseRef.current = promise;
    return promise;
  }, [course.id, employeeId, isCloud, session]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void syncNow(false);
    }, 5000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") void syncNow(false, true);
    };
    const handlePageHide = () => { void syncNow(Boolean(videoRef.current?.ended), true); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      void syncNow(Boolean(videoRef.current?.ended), true);
    };
  }, [syncNow]);

  React.useEffect(() => {
    flushProgressRef.current = () => syncNow(Boolean(videoRef.current?.ended));
    return () => {
      flushProgressRef.current = async () => undefined;
    };
  }, [flushProgressRef, syncNow]);

  function handleLoadedMetadata(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      durationRef.current = video.duration;
      setDurationSeconds(video.duration);
    }
    if (!completedRef.current && maximumRef.current > 0 && video.currentTime < maximumRef.current) {
      video.currentTime = Math.min(maximumRef.current, Math.max(0, video.duration - 0.1));
    }
    if (!completedRef.current && video.playbackRate !== 1) video.playbackRate = 1;
    setCurrentSeconds(video.currentTime);
    setPlaybackRate(video.playbackRate);
    playbackAnchorRef.current = null;
  }

  function handleTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    setCurrentSeconds(video.currentTime);
    if (video.seeking || seekCeilingRef.current !== null) return;
    const currentUpdateAt = performance.now();
    if (!completedRef.current && !playbackAnchorRef.current && !video.paused && video.currentTime >= maximumRef.current - 0.5) {
      playbackAnchorRef.current = {
        maximumAtStart: maximumRef.current,
        startedAt: currentUpdateAt
      };
    }
    const anchor = playbackAnchorRef.current;
    const allowedAdvance = anchor
      ? Math.max(0.1, (currentUpdateAt - anchor.startedAt) / 1000 * 1.25 + 0.25)
      : 0.1;
    const allowedCeiling = anchor
      ? Math.max(maximumRef.current, anchor.maximumAtStart + allowedAdvance)
      : maximumRef.current;
    const next = nextMaxWatchedSeconds({
      currentSeconds: video.currentTime,
      maxWatchedSeconds: maximumRef.current,
      completed: completedRef.current,
      toleranceSeconds: 0.05,
      maxAdvanceSeconds: Math.max(0.05, allowedCeiling - maximumRef.current)
    });
    if (!completedRef.current && (video.currentTime > allowedCeiling + 0.05 || next === maximumRef.current && video.currentTime > allowedCeiling)) {
      video.currentTime = maximumRef.current;
      return;
    }
    if (next > maximumRef.current) {
      maximumRef.current = next;
      setMaxWatchedSeconds(next);
    }
  }

  function handleSeeking(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (completedRef.current) return;
    if (seekCeilingRef.current === null) seekCeilingRef.current = maximumRef.current;
    const anchor = playbackAnchorRef.current;
    const currentUpdateAt = performance.now();
    const allowedCeiling = anchor
      ? Math.max(
        seekCeilingRef.current,
        anchor.maximumAtStart + Math.max(0, (currentUpdateAt - anchor.startedAt) / 1000) * 1.25 + 0.25
      )
      : seekCeilingRef.current;
    const allowed = allowedSeekTime({
      targetSeconds: video.currentTime,
      maxWatchedSeconds: allowedCeiling,
      completed: false
    });
    if (Math.abs(video.currentTime - allowed) < 0.01) return;
    video.currentTime = allowed;
    const now = Date.now();
    if (now - lastBlockedNoticeRef.current > 2000) {
      lastBlockedNoticeRef.current = now;
      onErrorRef.current("首次观看不能快进，完整看完后即可自由拖动");
    }
  }

  function handleSeeked(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (completedRef.current) {
      seekCeilingRef.current = null;
      return;
    }
    const ceiling = seekCeilingRef.current;
    if (ceiling === null) return;
    if (!correctingSeekRef.current && video.currentTime > ceiling + 0.05) {
      correctingSeekRef.current = true;
      video.currentTime = ceiling;
      return;
    }
    correctingSeekRef.current = false;
    if (video.currentTime < maximumRef.current - 0.25) playbackAnchorRef.current = null;
    if (!activeSeekGestureRef.current) seekCeilingRef.current = null;
  }

  function handleSeekGestureStart() {
    if (completedRef.current) return;
    activeSeekGestureRef.current = true;
    seekCeilingRef.current = maximumRef.current;
  }

  function handleSeekGestureEnd(event: React.PointerEvent<HTMLVideoElement>) {
    if (completedRef.current) return;
    const video = event.currentTarget;
    const ceiling = seekCeilingRef.current;
    activeSeekGestureRef.current = false;
    if (ceiling !== null && video.currentTime > ceiling + 0.05) {
      video.currentTime = ceiling;
    }
    window.setTimeout(() => {
      if (!activeSeekGestureRef.current) seekCeilingRef.current = null;
    }, 0);
  }

  function handleRateChange(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    const allowed = allowedPlaybackRate(video.playbackRate, completedRef.current);
    if (video.playbackRate !== allowed) {
      video.playbackRate = allowed;
      onErrorRef.current("首次观看固定为 1 倍速，完整看完后可调整倍速");
    }
    setPlaybackRate(allowed);
  }

  function handleEnded(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      durationRef.current = video.duration;
      maximumRef.current = video.duration;
      setDurationSeconds(video.duration);
      setMaxWatchedSeconds(video.duration);
    }
    void syncNow(true);
  }

  const percent = durationSeconds > 0 ? Math.min(100, Math.round(maxWatchedSeconds / durationSeconds * 100)) : 0;
  const seekRangeMaximum = completed
    ? Math.max(1, durationSeconds)
    : Math.max(0.1, maxWatchedSeconds);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function handleControlSeek(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const allowed = allowedSeekTime({
      targetSeconds: Number(event.currentTarget.value),
      maxWatchedSeconds: seekCeilingRef.current ?? maximumRef.current,
      completed: completedRef.current
    });
    video.currentTime = allowed;
    setCurrentSeconds(allowed);
  }

  function handleControlSeekStart() {
    if (completedRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    seekCeilingRef.current = maximumRef.current;
    resumeAfterControlSeekRef.current = !video.paused;
    video.pause();
  }

  function handleControlSeekEnd() {
    if (completedRef.current) return;
    const video = videoRef.current;
    seekCeilingRef.current = null;
    if (video && resumeAfterControlSeekRef.current) void video.play();
    resumeAfterControlSeekRef.current = false;
  }

  function handleControlRate(event: React.ChangeEvent<HTMLSelectElement>) {
    const video = videoRef.current;
    if (!video) return;
    const allowed = allowedPlaybackRate(Number(event.currentTarget.value), completedRef.current);
    video.playbackRate = allowed;
    setPlaybackRate(allowed);
  }

  function toggleExpandedMode() {
    setExpanded((value) => !value);
  }

  return (
    <div className={`restricted-video-player${expanded ? " is-expanded" : ""}`}>
      <div className="video-player-stage">
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          poster={poster}
          src={src}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onPointerDown={handleSeekGestureStart}
          onPointerUp={handleSeekGestureEnd}
          onPointerCancel={handleSeekGestureEnd}
          onRateChange={handleRateChange}
          onPlay={(event) => {
            setPaused(false);
            playbackAnchorRef.current = event.currentTarget.currentTime >= maximumRef.current - 0.5
              ? { maximumAtStart: maximumRef.current, startedAt: performance.now() }
              : null;
          }}
          onPause={() => {
            setPaused(true);
            playbackAnchorRef.current = null;
            void syncNow(false);
          }}
          onEnded={handleEnded}
        />
      </div>
      <div className="video-player-controls">
        <button type="button" className="video-player-toggle" onClick={togglePlayback} aria-label={paused ? "播放视频" : "暂停视频"}>
          {paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
        </button>
        <span className="video-player-time">{formatVideoTime(currentSeconds)}</span>
        <input
          type="range"
          min="0"
          max={seekRangeMaximum}
          step="0.1"
          value={Math.min(currentSeconds, seekRangeMaximum)}
          onChange={handleControlSeek}
          onPointerDown={handleControlSeekStart}
          onPointerUp={handleControlSeekEnd}
          onPointerCancel={handleControlSeekEnd}
          aria-label={completed ? "视频进度" : "已观看进度，可向左回看"}
        />
        <span className="video-player-time">{formatVideoTime(durationSeconds)}</span>
        <select value={playbackRate} onChange={handleControlRate} aria-label="播放速度" disabled={!completed}>
          <option value="1">1x</option>
          {completed ? <option value="1.25">1.25x</option> : null}
          {completed ? <option value="1.5">1.5x</option> : null}
          {completed ? <option value="2">2x</option> : null}
        </select>
        <button
          type="button"
          className="video-player-fullscreen"
          onClick={toggleExpandedMode}
          aria-label={expanded ? "收起播放器" : "展开播放器"}
          title={expanded ? "收起播放器" : "展开播放器"}
        >
          {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      <div className={`video-learning-rule${completed || readOnly ? " is-complete" : ""}`} aria-live="polite">
        {readOnly ? <CheckCircle2 size={17} /> : completed ? <CheckCircle2 size={17} /> : syncing ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
        <span>
          <strong>{readOnly ? "供应商只读查看" : completed ? "首次观看已完成" : syncing ? "正在同步学习进度" : "首次观看不可快进"}</strong>
          <small>{readOnly ? "不会记录进度或发放金豆" : completed ? "现在可以自由回看和调整倍速" : `可以暂停和回看 · 已观看 ${percent}%`}</small>
        </span>
      </div>
    </div>
  );
}
