import React from "react";
import { ArrowRight, BookOpen, CheckCircle2, Clock3, FileText, HeartPulse, LoaderCircle, Presentation, Sparkles, Video, VideoOff } from "lucide-react";
import { completeCourse, loadCourseDetail } from "../data";
import type { EmployeeAppData } from "../data";
import type { PageProps } from "../appTypes";
import { applyCourseReward } from "../quickActionStateCore.js";
import { BeanBadge, EmptyState, PageHeader, SegmentedControl } from "../components";
import { courseResourceLabel, isPptCourse, isPptSlideDeckReady } from "../courseMaterialCore.js";
import { courseIdValue, courseLearningCompleted } from "../courseCompletionCore.js";
import { courseProgressPercent } from "../learningProgressCore.js";
import { canCompleteVideoCourse, playableVideoUrl } from "../videoCompletion.js";
import { PptCoursePlayer } from "./PptCoursePlayer";
import { RestrictedVideoPlayer } from "./RestrictedVideoPlayer";

type Track = "product" | "chronic";
type AppCourse = EmployeeAppData["courses"][number];

const chronicNames: Record<string, string> = {
  diabetes: "糖尿病",
  hypertension: "高血压",
  hyperuricemia: "高尿酸",
  hyperlipidemia: "高血脂"
};

export function LearningPage({ data, session, busy, navigate, notify, refresh, recordLearningProgress, runAction }: PageProps) {
  const [track, setTrack] = React.useState<Track>("product");
  const [collection, setCollection] = React.useState("");
  const [detail, setDetail] = React.useState<AppCourse | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [watched, setWatched] = React.useState(false);
  const [completedCourseIds, setCompletedCourseIds] = React.useState<Set<string>>(() => new Set());
  const groups = groupCourses(data.courses, track, completedCourseIds);
  const currentGroup = groups.find((group) => group.key === collection);

  React.useEffect(() => {
    setCompletedCourseIds(new Set());
  }, [data.employee.id]);

  function markCourseLearningComplete(course: AppCourse | string) {
    const courseId = typeof course === "string" ? course : courseIdValue(course);
    if (!courseId) return;
    setCompletedCourseIds((current) => {
      if (current.has(courseId)) return current;
      const next = new Set(current);
      next.add(courseId);
      return next;
    });
  }

  function handleCourseLearningComplete(course: AppCourse, resourceType: "video" | "ppt") {
    const courseId = courseIdValue(course);
    markCourseLearningComplete(courseId);
    setWatched(true);
    setDetail((current) => current && courseIdValue(current) === courseId
      ? { ...current, learningCompleted: true, progress: 100 }
      : current);
    void recordLearningProgress(courseId, resourceType).catch((error) => {
      notify({ type: "error", text: error instanceof Error ? error.message : "学习进度同步失败，请返回后刷新" });
    });
  }

  function returnFromCourse() {
    // Leave the player immediately. Progress writes and the list refresh must
    // never hold the back button behind a slow mobile network request.
    setDetail(null);
    window.setTimeout(() => {
      void refresh().catch(() => {
        notify({ type: "error", text: "已返回课程列表，最新进度将在网络恢复后同步" });
      });
    }, 0);
  }

  function changeTrack(value: Track) {
    setTrack(value);
    setCollection("");
    setDetail(null);
  }

  async function openCourse(course: AppCourse) {
    setWatched(courseLearningCompleted(course, completedCourseIds));
    if (data.source === "fallback") {
      setDetail(course);
      return;
    }
    if (!session) return;
    setLoadingDetail(true);
    try {
      const result = await loadCourseDetail(session, course.id);
      setDetail(result.course);
      const learningCompleted = courseLearningCompleted(result.course, completedCourseIds);
      setWatched(learningCompleted);
      if (learningCompleted) markCourseLearningComplete(result.course);
    } catch (error) {
      notify({ type: "error", text: error instanceof Error ? error.message : "资料加载失败" });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function finishCourse(pptReadingComplete = false) {
    if (!detail || (!session && data.source !== "fallback")) return;
    if (detail.resourceType === "ppt") {
      if (!pptReadingComplete) {
        notify({ type: "error", text: "请按顺序完成全部 PPT 页面后再记录完成" });
        return;
      }
    } else if (!canCompleteVideoCourse(detail, watched)) {
      notify({ type: "error", text: "视频尚未上传或未播放完成，暂不能完成或领取金豆" });
      return;
    }
    const result = await runAction(`course-${detail.id}`, () => completeCourse(session!, detail.id, { pptCompleted: detail.resourceType === "ppt" }), {
      demoAction: { type: "completeCourse", payload: { courseId: detail.id } },
      refreshMode: "background",
      applyResult: (current, actionResult) => applyCourseReward(current, detail.id, actionResult.data)
    });
    if (result) {
      markCourseLearningComplete(detail);
      setDetail((current) => current ? { ...current, completed: true, learningCompleted: true, progress: 100 } : current);
    }
  }

  if (detail) {
    if (isPptSlideDeckReady(detail)) {
      return <PptCoursePlayer course={detail} employeeId={data.employee.id} session={session} dataSource={data.source} readOnly={data.isSupplier} busy={busy === `course-${detail.id}`} onBack={returnFromCourse} onLearningComplete={() => handleCourseLearningComplete(detail, "ppt")} onComplete={() => finishCourse(true)} onError={(text) => notify({ type: "error", text })} />;
    }
    return <CoursePlayer course={detail} employeeId={data.employee.id} session={session} dataSource={data.source} readOnly={data.isSupplier} watched={watched} busy={busy === `course-${detail.id}`} onWatched={() => handleCourseLearningComplete(detail, "video")} onError={(text) => notify({ type: "error", text })} onBack={returnFromCourse} onComplete={finishCourse} />;
  }

  return (
    <div>
      <PageHeader title={currentGroup ? currentGroup.title : "内部资料"} subtitle={currentGroup ? `${currentGroup.courses.length} 项内部资料` : "按产品或慢病主题查看岗位资料"} onBack={() => currentGroup ? setCollection("") : navigate("home")} action={<BeanBadge value={data.employee.goldenBeans} />} />
      {!currentGroup ? <SegmentedControl value={track} options={[{ value: "product", label: "产品资料" }, { value: "chronic", label: "慢病资料" }]} onChange={changeTrack} /> : null}

      {loadingDetail ? <div className="inline-loading"><LoaderCircle className="spin" size={21} />正在准备资料</div> : null}
      {!currentGroup ? (
        groups.length ? <div className="collection-list">{groups.map((group, index) => (
          <button type="button" key={group.key} onClick={() => setCollection(group.key)}>
            <span className={`collection-visual collection-visual-${index % 4}`}>
              {group.image ? <img src={group.image} alt="" /> : track === "chronic" ? <HeartPulse size={30} /> : <BookOpen size={30} />}
            </span>
            <span className="collection-copy"><strong>{group.title}</strong><small>{taskText(group.taskStatus)} · {group.courses.length} 项内容 · {group.completed} 项已完成 · 进度 {group.progress}%</small><i><span style={{ width: `${group.progress}%` }} /></i></span>
            <ArrowRight size={19} />
          </button>
        ))}</div> : <EmptyState title="暂无内部资料" text="后台发布资料后会显示在这里" />
      ) : (
        <div className="lesson-list">
          {currentGroup.courses.map((course, index) => (
            <button type="button" key={course.id} onClick={() => openCourse(course)}>
              <span className="lesson-index">{courseLearningCompleted(course, completedCourseIds) ? <CheckCircle2 size={20} /> : String(index + 1).padStart(2, "0")}</span>
              <span className="lesson-copy"><strong>{course.title}</strong><small><Clock3 size={13} />{course.duration || "时长待定"}{isPptCourse(course) ? <><Presentation size={13} />{courseResourceLabel(course)}</> : course.hasVideo ? <><Video size={13} />视频</> : <><FileText size={13} />资料</>}{courseLearningCompleted(course, completedCourseIds) ? <em className="lesson-complete-label">已完成</em> : null}</small></span>
              <span className="lesson-beans">{Number(course.goldenBeans || 0) > 0 ? `+${course.goldenBeans}` : "记录"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CoursePlayer({ course, employeeId, session, dataSource, readOnly = false, watched, busy, onWatched, onError, onBack, onComplete }: { course: AppCourse; employeeId: string; session: PageProps["session"]; dataSource: EmployeeAppData["source"]; readOnly?: boolean; watched: boolean; busy: boolean; onWatched: () => void; onError: (message: string) => void; onBack: () => void; onComplete: () => void }) {
  const flushProgressRef = React.useRef<() => Promise<unknown>>(async () => undefined);
  const playableUrl = playableVideoUrl(course);
  const pptWaitingForSlides = isPptCourse(course) && !isPptSlideDeckReady(course);
  const canClaim = pptWaitingForSlides ? false : canCompleteVideoCourse(course, watched);
  const hasPlayableVideo = Boolean(playableUrl);
  return (
    <div>
      <PageHeader title="资料查看" subtitle={course.productName || chronicNames[course.chronicCategory || ""] || "内部资料"} onBack={() => {
        const flushProgress = flushProgressRef.current;
        void flushProgress().catch(() => undefined);
        onBack();
      }} />
      <section className="course-player">
        {playableUrl ? (
          <RestrictedVideoPlayer course={course} employeeId={employeeId} session={session} dataSource={dataSource} readOnly={readOnly} poster={course.coverImageUrl || course.coverImage} onWatched={onWatched} onError={onError} flushProgressRef={flushProgressRef} src={playableUrl} />
        ) : (
          <div className="video-placeholder" role="img" aria-label={pptWaitingForSlides ? "PPT页面待生成" : "视频待上传"}>
            <span>{pptWaitingForSlides ? <Presentation size={27} /> : <VideoOff size={27} />}</span>
            <strong>{pptWaitingForSlides ? "PPT页面待生成" : "视频待上传"}</strong>
            {pptWaitingForSlides ? <small>请先在后台完成 PPT 转图片后再开放学习</small> : null}
          </div>
        )}
        <div className="course-detail-copy">
          <span className="course-label">{course.track === "chronic" ? "慢病资料" : "产品资料"}</span>
          <h1>{course.title}</h1>
          <p>{course.description}</p>
          <div className="course-meta"><span><Clock3 size={16} />{course.duration || "时长待定"}</span><span><Sparkles size={16} />{pptWaitingForSlides ? "PPT页面生成后开放学习" : course.taskAutoCompleted && !course.completed ? "任务已完成；完成学习后可领取金豆" : hasPlayableVideo ? `完成可得 ${course.goldenBeans} 金豆` : "视频上传后开放奖励"}</span></div>
        </div>
      </section>
      <div className="sticky-action-bar">
        <div><small>{course.completed ? "资料状态" : course.taskAutoCompleted ? "任务状态" : hasPlayableVideo ? "完成奖励" : "完成条件"}</small><strong>{course.completed ? "已完成" : course.taskAutoCompleted ? "任务已完成，可继续学习" : hasPlayableVideo ? `+${course.goldenBeans} 金豆` : "暂不可完成"}</strong></div>
        <button className="primary-button" type="button" disabled={readOnly || !canClaim || busy || Boolean(course.completed)} onClick={onComplete}>{readOnly ? "只读查看" : course.completed ? "已完成" : busy ? "领取中" : pptWaitingForSlides ? "PPT生成后可学习" : !hasPlayableVideo ? "视频上传后可学习" : watched ? "完成并领取" : "播放完成后领取"}</button>
      </div>
    </div>
  );
}

function groupCourses(courses: AppCourse[], track: Track, completedCourseIds: ReadonlySet<string> = new Set()) {
  const filtered = courses.filter((course) => (course.track || "product") === track);
  const map = new Map<string, { key: string; title: string; image: string; courses: AppCourse[]; completed: number; taskStatus?: AppCourse["taskStatus"] }>();
  filtered.forEach((course) => {
    const key = track === "product" ? course.productName || "其他产品" : course.chronicCategory || "chronic";
    const title = track === "product" ? key : chronicNames[key] || "慢病基础";
    const group = map.get(key) || { key, title, image: course.productImageUrl || course.productImage || "", courses: [], completed: 0, taskStatus: course.taskStatus };
    group.courses.push(course);
    if (courseLearningCompleted(course, completedCourseIds)) group.completed += 1;
    map.set(key, group);
  });
  return [...map.values()].map((group) => {
    const orderedCourses = [...group.courses].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const progress = orderedCourses.length
      ? Math.round(orderedCourses.reduce((sum, course) => sum + courseProgressPercent(course, completedCourseIds), 0) / orderedCourses.length)
      : 0;
    return { ...group, courses: orderedCourses, progress };
  });
}

function taskText(status: AppCourse["taskStatus"]) {
  return status === "completed" ? "任务已完成，可继续学习" : status === "learning-required" ? "需学习" : "需考试";
}
