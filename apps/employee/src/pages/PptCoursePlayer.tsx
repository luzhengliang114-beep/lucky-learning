import React from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Maximize2, Minimize2, Presentation, RefreshCw } from "lucide-react";
import {
  completePptReadingSlide,
  loadPptReadingProgress,
  startPptReadingSlide,
  type EmployeeAppData,
  type EmployeeSession,
  type PptReadingProgress
} from "../data";
import { PageHeader } from "../components";
import { moveToPptSlide, normalizePptProgress, pptSlideImageUrl, readonlyPptProgress, unlockCurrentPptSlide } from "../pptProgressCore.js";
import { canSubmitPptSlideCompletion, createPptUnlockRequestTracker } from "../pptUnlockRequestCore.js";

type AppCourse = EmployeeAppData["courses"][number];
type PptProgress = {
  slideCount: number;
  currentSlide: number;
  unlockedSlides: number;
  completed: boolean;
};
const storagePrefix = "employee-ppt-progress-v1";

function storageKey(employeeId: string, courseId: string) {
  return `${storagePrefix}:${employeeId || "preview"}:${courseId}`;
}

function loadProgress(employeeId: string, course: AppCourse): PptProgress {
  const slideCount = Math.max(1, Number(course.slideCount || 1));
  if (course.completed) {
    return normalizePptProgress({ currentSlide: slideCount - 1, unlockedSlides: slideCount }, slideCount);
  }
  try {
    const raw = window.localStorage?.getItem(storageKey(employeeId, course.id));
    return normalizePptProgress(raw ? JSON.parse(raw) : null, slideCount);
  } catch {
    return normalizePptProgress(null, slideCount);
  }
}

function saveProgress(employeeId: string, courseId: string, progress: PptProgress) {
  try {
    window.localStorage?.setItem(storageKey(employeeId, courseId), JSON.stringify(progress));
  } catch {
    // The current reading session still works when embedded browsers block storage.
  }
}

function normalizeRemoteProgress(progress: PptReadingProgress, slideCount: number): PptProgress {
  return normalizePptProgress({
    currentSlide: progress.currentSlide,
    unlockedSlides: progress.unlockedSlides
  }, slideCount);
}

export function PptCoursePlayer({
  course,
  employeeId,
  session,
  dataSource,
  readOnly = false,
  busy,
  onBack,
  onLearningComplete,
  onComplete,
  onError
}: {
  course: AppCourse;
  employeeId: string;
  session: EmployeeSession | null;
  dataSource: EmployeeAppData["source"];
  readOnly?: boolean;
  busy: boolean;
  onBack: () => void;
  onLearningComplete: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const minSeconds = Math.max(1, Number(course.slideMinSeconds || 3));
  const requiredMs = minSeconds * 1000;
  const [progress, setProgress] = React.useState<PptProgress>(() => readOnly ? readonlyPptProgress(Number(course.slideCount || 1)) : loadProgress(employeeId, course));
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [imageAttempt, setImageAttempt] = React.useState(0);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [remoteLoaded, setRemoteLoaded] = React.useState(dataSource !== "cloudbase" || readOnly);
  const [timerReady, setTimerReady] = React.useState(dataSource !== "cloudbase" || readOnly);
  const [syncing, setSyncing] = React.useState(false);
  const [unlocking, setUnlocking] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const onErrorRef = React.useRef(onError);
  const onLearningCompleteRef = React.useRef(onLearningComplete);
  const completionReportedRef = React.useRef(false);
  const unlockRequestTrackerRef = React.useRef(createPptUnlockRequestTracker());
  const timedSlideRef = React.useRef<number | null>(null);
  const viewerHistoryRef = React.useRef(false);
  const isCloud = dataSource === "cloudbase" && Boolean(session) && !readOnly;
  const currentUnlocked = progress.currentSlide < progress.unlockedSlides;
  const currentImage = pptSlideImageUrl(course, progress.currentSlide);
  const remainingMs = currentUnlocked ? 0 : Math.max(0, requiredMs - elapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const pageProgress = Math.round((readOnly ? progress.currentSlide + 1 : progress.unlockedSlides) / progress.slideCount * 100);
  const isLastPage = progress.currentSlide === progress.slideCount - 1;

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  React.useEffect(() => {
    onLearningCompleteRef.current = onLearningComplete;
  }, [onLearningComplete]);

  React.useEffect(() => {
    completionReportedRef.current = false;
  }, [course.id]);

  React.useEffect(() => {
    if (!progress.completed || (isCloud && !remoteLoaded) || completionReportedRef.current) return;
    completionReportedRef.current = true;
    onLearningCompleteRef.current();
  }, [isCloud, progress.completed, remoteLoaded]);

  React.useEffect(() => {
    unlockRequestTrackerRef.current.reset();
    setUnlocking(false);
  }, [course.id, session]);

  React.useEffect(() => () => {
    unlockRequestTrackerRef.current.reset();
  }, []);

  React.useEffect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
    };
    const handlePopState = () => {
      viewerHistoryRef.current = false;
      setViewerOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [viewerOpen]);

  React.useEffect(() => {
    if (!isCloud || !session) return;
    let cancelled = false;
    setRemoteLoaded(false);
    setSyncing(true);
    loadPptReadingProgress(session, course.id)
      .then((remote) => {
        if (cancelled) return;
        const next = normalizeRemoteProgress(remote, progress.slideCount);
        setProgress(next);
        saveProgress(employeeId, course.id, next);
        setRemoteLoaded(true);
      })
      .catch((error) => {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : "PPT 学习进度加载失败");
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => { cancelled = true; };
  }, [course.id, employeeId, isCloud, progress.slideCount, session]);

  React.useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setElapsedMs(currentUnlocked ? requiredMs : 0);
    setTimerReady(!isCloud || currentUnlocked);
    timedSlideRef.current = currentUnlocked ? progress.currentSlide : null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [isCloud, progress.currentSlide, requiredMs]);

  React.useEffect(() => {
    if (!imageLoaded || imageError || currentUnlocked || !remoteLoaded) return;
    if (!isCloud || !session) {
      timedSlideRef.current = progress.currentSlide;
      setTimerReady(true);
      return;
    }
    let cancelled = false;
    setTimerReady(false);
    setSyncing(true);
    startPptReadingSlide(session, course.id, progress.currentSlide)
      .then((remote) => {
        if (cancelled) return;
        const next = normalizeRemoteProgress(remote, progress.slideCount);
        setProgress(next);
        saveProgress(employeeId, course.id, next);
        timedSlideRef.current = progress.currentSlide;
        setTimerReady(true);
      })
      .catch((error) => {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : "本页计时启动失败");
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => { cancelled = true; };
  }, [course.id, currentUnlocked, employeeId, imageError, imageLoaded, isCloud, progress.currentSlide, progress.slideCount, remoteLoaded, session]);

  React.useEffect(() => {
    if (!imageLoaded || imageError || currentUnlocked || !timerReady) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setElapsedMs((value) => Math.min(requiredMs, value + 100));
    }, 100);
    return () => window.clearInterval(interval);
  }, [currentUnlocked, imageError, imageLoaded, requiredMs, timerReady]);

  React.useEffect(() => {
    if (!canSubmitPptSlideCompletion({
      currentSlide: progress.currentSlide,
      timedSlide: timedSlideRef.current,
      imageLoaded,
      imageError,
      timerReady,
      currentUnlocked,
      elapsedMs,
      requiredMs
    })) return;
    if (!isCloud || !session) {
      const result = unlockCurrentPptSlide(progress, elapsedMs, minSeconds);
      if (!result.unlocked) return;
      setProgress(result.progress);
      saveProgress(employeeId, course.id, result.progress);
      return;
    }

    const slideIndex = progress.currentSlide;
    const requestKey = `${course.id}:${slideIndex}`;
    const requestTracker = unlockRequestTrackerRef.current;
    const requestToken = requestTracker.begin(requestKey);
    if (!requestToken) return;
    setUnlocking(true);
    completePptReadingSlide(session, course.id, slideIndex)
      .then((remote) => {
        if (!requestTracker.isCurrent(requestToken)) return;
        const next = normalizeRemoteProgress(remote, progress.slideCount);
        setProgress(next);
        saveProgress(employeeId, course.id, next);
      })
      .catch((error) => {
        if (!requestTracker.isCurrent(requestToken)) return;
        requestTracker.release(requestToken);
        setUnlocking(false);
        onErrorRef.current(error instanceof Error ? error.message : "本页进度保存失败");
      })
      .finally(() => {
        if (requestTracker.isCurrent(requestToken)) setUnlocking(false);
      });
  }, [course.id, currentUnlocked, elapsedMs, employeeId, imageError, imageLoaded, isCloud, minSeconds, progress, requiredMs, session, timerReady]);

  React.useEffect(() => {
    if (!imageLoaded || progress.currentSlide >= progress.slideCount - 1) return;
    const nextImage = new Image();
    nextImage.src = pptSlideImageUrl(course, progress.currentSlide + 1);
  }, [course, imageLoaded, progress.currentSlide, progress.slideCount]);

  function move(target: number) {
    try {
      const next = moveToPptSlide(progress, target);
      timedSlideRef.current = null;
      setElapsedMs(0);
      setTimerReady(false);
      setImageLoaded(false);
      setImageError(false);
      setProgress(next);
      if (!readOnly) saveProgress(employeeId, course.id, next);
    } catch {
      // Navigation controls prevent unavailable targets; this is a defensive fallback.
    }
  }

  function retryImage() {
    setImageError(false);
    setImageLoaded(false);
    setImageAttempt((value) => value + 1);
  }

  function openViewer() {
    setViewerOpen(true);
    if (!viewerHistoryRef.current) {
      window.history.pushState({ pptViewer: course.id }, "");
      viewerHistoryRef.current = true;
    }
  }

  function closeViewer() {
    if (viewerHistoryRef.current) {
      viewerHistoryRef.current = false;
      window.history.back();
      window.setTimeout(() => setViewerOpen(false), 120);
      return;
    }
    setViewerOpen(false);
  }

  return (
    <div>
      <PageHeader title="PPT 学习" subtitle={course.productName || "产品资料"} onBack={onBack} />
      <section className="ppt-reader" aria-label={`${course.title} PPT 阅读器`}>
        <header className="ppt-reader-heading">
          <span><Presentation size={18} />产品培训资料</span>
          <strong>{course.title}</strong>
          <small>第 {progress.currentSlide + 1} 页 / 共 {progress.slideCount} 页</small>
        </header>

        <div className="ppt-progress" aria-label={`已完成 ${pageProgress}%`}>
          <span style={{ width: `${pageProgress}%` }} />
        </div>

        <div className={`ppt-slide-frame${imageError ? " is-error" : ""}`}>
          {!imageLoaded && !imageError ? <div className="ppt-slide-loading"><LoaderCircle className="spin" size={24} /><span>正在加载第 {progress.currentSlide + 1} 页</span></div> : null}
          {imageError ? (
            <div className="ppt-slide-loading">
              <RefreshCw size={24} />
              <strong>这一页暂时加载失败</strong>
              <button type="button" onClick={retryImage}>重新加载</button>
            </div>
          ) : (
            <img
              key={`${currentImage}-${imageAttempt}`}
              src={currentImage}
              alt={`${course.title}第 ${progress.currentSlide + 1} 页`}
              onLoad={(event) => {
                setImageLoaded(true);
              }}
              onError={() => setImageError(true)}
              onClick={imageLoaded ? openViewer : undefined}
            />
          )}
          {imageLoaded && !imageError ? (
            <button type="button" className="ppt-expand-button" onClick={openViewer} aria-label="放大查看本页" title="放大查看">
              <Maximize2 size={18} />
            </button>
          ) : null}
        </div>

        <div className="ppt-page-status" aria-live="polite">
          {readOnly ? (
            <><CheckCircle2 size={18} /><strong>供应商只读查看</strong><span>可查看全部页面，不记录学习进度</span></>
          ) : currentUnlocked ? (
            <><CheckCircle2 size={18} /><strong>本页已完成</strong><span>可以继续或返回复习</span></>
          ) : unlocking ? (
            <><LoaderCircle className="spin" size={18} /><strong>正在保存本页进度</strong><span>保存成功后即可进入下一页</span></>
          ) : syncing ? (
            <><LoaderCircle className="spin" size={18} /><strong>正在同步学习进度</strong><span>同步完成后开始计时</span></>
          ) : imageLoaded ? (
            <><Clock3 size={18} /><strong>{remainingSeconds > 0 ? `本页还需 ${remainingSeconds} 秒` : "本页已完成"}</strong><span>请保持页面在前台</span></>
          ) : (
            <><Clock3 size={18} /><strong>图片加载后开始计时</strong><span>加载时间不计入学习时长</span></>
          )}
        </div>

        <div className="ppt-reader-actions">
          <button className="secondary-button" type="button" disabled={progress.currentSlide === 0} onClick={() => move(progress.currentSlide - 1)}>
            <ChevronLeft size={18} />上一页
          </button>
          {isLastPage ? (
            <button className="primary-button" type="button" disabled={readOnly || !progress.completed || busy || Boolean(course.completed)} onClick={onComplete}>
              {readOnly ? <><CheckCircle2 size={18} />只读查看</> : course.completed ? <><CheckCircle2 size={18} />已完成</> : busy ? <><LoaderCircle className="spin" size={18} />记录中</> : <><CheckCircle2 size={18} />完成学习</>}
            </button>
          ) : (
            <button className="primary-button" type="button" disabled={!currentUnlocked} onClick={() => move(progress.currentSlide + 1)}>
              下一页<ChevronRight size={18} />
            </button>
          )}
        </div>
      </section>

      <p className="ppt-learning-note">{readOnly ? "供应商只读查看 · 不记录学习进度 · 不发放金豆" : `每页至少学习 ${minSeconds} 秒 · 切换到后台会暂停计时 · ${course.taskAutoCompleted && !course.completed ? "任务已完成；完成本课程后可领取金豆" : "完成本课程后记录学习"}`}</p>

      {viewerOpen ? (
        <div className="ppt-viewer" role="dialog" aria-modal="true" aria-label={`${course.title}第 ${progress.currentSlide + 1} 页放大查看`}>
          <header className="ppt-viewer-toolbar">
            <div>
              <strong>第 {progress.currentSlide + 1} / {progress.slideCount} 页</strong>
              <small>{readOnly ? "供应商只读查看" : currentUnlocked ? "本页已完成" : remainingSeconds > 0 ? `还需 ${remainingSeconds} 秒` : "正在保存进度"}</small>
            </div>
            <div className="ppt-viewer-tools">
              <button type="button" onClick={closeViewer} aria-label="退出放大查看"><Minimize2 size={19} /></button>
            </div>
          </header>
          <div className="ppt-viewer-stage">
            <img
              className="ppt-viewer-media"
              src={currentImage}
              alt={`${course.title}第 ${progress.currentSlide + 1} 页放大图`}
              draggable={false}
              onError={() => setImageError(true)}
            />
          </div>
          <footer className="ppt-viewer-navigation">
            <button type="button" disabled={progress.currentSlide === 0} onClick={() => move(progress.currentSlide - 1)}><ChevronLeft size={19} />上一页</button>
            <span>第 {progress.currentSlide + 1} / {progress.slideCount} 页</span>
            <button type="button" disabled={isLastPage || !currentUnlocked} onClick={() => move(progress.currentSlide + 1)}>下一页<ChevronRight size={19} /></button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
