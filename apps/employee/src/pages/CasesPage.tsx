import React from "react";
import { BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, Download, Image as ImageIcon, MessageCircle, Plus, Send, Upload, Video, X } from "lucide-react";
import { acknowledgeCase, addComment, submitContent, uploadMedia } from "../data";
import type { CasePost } from "../data";
import type { PageProps } from "../appTypes";
import { Avatar, EmptyState, PageHeader, SegmentedControl, StatusPill } from "../components";
import { applyCaseAcknowledgement } from "../quickActionStateCore.js";

type FeedFilter = "all" | "official";

export function CasesPage({ data, session, busy, navigate, notify, runAction }: PageProps) {
  const [filter, setFilter] = React.useState<FeedFilter>("all");
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [commentingId, setCommentingId] = React.useState("");
  const [comment, setComment] = React.useState("");
  const cases = filter === "official" ? data.cases.filter((item) => item.publisherRole === "admin") : data.cases;

  async function publishComment(caseId: string) {
    if (!comment.trim() || (!session && data.source !== "fallback")) return;
    const content = comment.trim();
    const result = await runAction(`comment-${caseId}`, () => addComment(session!, caseId, content), {
      demoAction: { type: "addComment", payload: { caseId, content } }
    });
    if (result) {
      setComment("");
      setCommentingId("");
    }
  }

  async function confirmReceived(caseId: string) {
    if (!session && data.source !== "fallback") return;
    await runAction(`acknowledge-case-${caseId}`, () => acknowledgeCase(session!, caseId), {
      demoAction: { type: "acknowledgeCase", payload: { caseId } },
      refreshMode: "none",
      applyResult: (current, result) => applyCaseAcknowledgement(current, caseId, result.data?.acknowledgedAt)
    });
  }

  return (
    <div>
      <PageHeader title="案例广场" subtitle="全体员工的经验分享" onBack={() => navigate("home")} action={<button className="icon-button strong" type="button" aria-label="发布案例" title="发布案例" onClick={() => setComposerOpen(true)}><Plus size={21} /></button>} />
      <SegmentedControl value={filter} options={[{ value: "all", label: "最新案例" }, { value: "official", label: "官方发布" }]} onChange={setFilter} />
      {cases.length ? <div className="case-feed">{cases.map((item) => (
        <CaseCard key={item.id} item={item} isAdmin={data.employee.role === "admin"} commenting={commentingId === item.id} comment={comment} busy={busy === `comment-${item.id}`} acknowledgementBusy={busy === `acknowledge-case-${item.id}`} onAcknowledge={() => confirmReceived(item.id)} onComment={() => { setCommentingId(item.id); setComment(""); }} onCommentChange={setComment} onCancelComment={() => setCommentingId("")} onPublishComment={() => publishComment(item.id)} />
      ))}</div> : <EmptyState icon={<MessageCircle size={24} />} title="暂时没有案例" text="分享门店实践，让好经验被更多同事看见" />}
      <button className="floating-compose" type="button" onClick={() => setComposerOpen(true)}><Plus size={22} /><span>发布</span></button>
      {composerOpen ? <CaseComposer data={data} session={session} busy={busy === "publish-case"} notify={notify} runAction={runAction} onClose={() => setComposerOpen(false)} /> : null}
    </div>
  );
}

function CaseCard({ item, isAdmin, commenting, comment, busy, acknowledgementBusy, onAcknowledge, onComment, onCommentChange, onCancelComment, onPublishComment }: { item: CasePost; isAdmin: boolean; commenting: boolean; comment: string; busy: boolean; acknowledgementBusy: boolean; onAcknowledge: () => void; onComment: () => void; onCommentChange: (value: string) => void; onCancelComment: () => void; onPublishComment: () => void }) {
  const images = (item.images || []).map((image) => image.url || image.imageUrl || "").filter(Boolean);
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);

  return (
    <article className="case-post">
      <header>
        <Avatar employee={{ name: item.publisherName || "门店员工", avatarUrl: item.publisherAvatar }} size="small" />
        <div><strong>{item.publisherName || "门店员工"}{item.publisherRole === "admin" ? <BadgeCheck className="official-badge" size={16} /> : null}</strong><small>{formatTime(item.createdAt)} · {item.publisherRole === "admin" ? "官方发布" : item.publisherStore || "所属门店"}</small></div>
        <StatusPill status={item.status} />
      </header>
      <h2>{item.title}</h2>
      {item.content ? <p>{item.content}</p> : null}
      {images.length ? <div className={`case-images case-images-${Math.min(images.length, 3)}`}>{images.map((image, index) => <button type="button" key={`${item.id}-${index}`} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => setPreviewIndex(index)}><img loading="lazy" src={image} alt={`${item.title} 第 ${index + 1} 张图片`} /></button>)}</div> : null}
      {item.videoUrl ? <video controls playsInline preload="metadata" src={item.videoUrl} /> : null}
      <footer className={item.acknowledgementRequired ? "has-acknowledgement" : ""}>
        {item.acknowledgementRequired ? item.acknowledgementStatus === "acknowledged"
          ? <span className="case-acknowledged"><CheckCircle2 size={16} />已收到{item.acknowledgedAt ? ` · ${formatTime(item.acknowledgedAt)}` : ""}</span>
          : <button className="case-acknowledge-button" disabled={acknowledgementBusy} type="button" onClick={onAcknowledge}><CheckCircle2 size={16} />{acknowledgementBusy ? "确认中" : "确认已收到"}</button>
          : null}
        <button type="button" onClick={onComment}><MessageCircle size={18} /><span>{item.commentCount || 0} 评论</span></button>
      </footer>
      {isAdmin && item.acknowledgementRequired ? <p className="case-acknowledgement-summary">已确认 {item.acknowledgementAcknowledgedCount || 0}/{item.acknowledgementTargetCount || 0} · 还有 {item.acknowledgementPendingCount || 0} 人未确认</p> : null}
      {item.comments?.length ? <div className="case-comments">{item.comments.map((entry) => <p key={entry.id}><strong>{entry.employeeName}</strong><span>{entry.content}</span></p>)}</div> : null}
      {commenting ? <div className="comment-box"><input autoFocus value={comment} onChange={(event) => onCommentChange(event.target.value)} placeholder="写下你的评论" /><button type="button" onClick={onCancelComment}>取消</button><button className="send" type="button" aria-label="发送评论" title="发送评论" disabled={!comment.trim() || busy} onClick={onPublishComment}><Send size={17} /></button></div> : null}
      {previewIndex !== null ? <ImagePreview images={images} initialIndex={previewIndex} title={item.title} onClose={() => setPreviewIndex(null)} /> : null}
    </article>
  );
}

function ImagePreview({ images, initialIndex, title, onClose }: { images: string[]; initialIndex: number; title: string; onClose: () => void }) {
  const [index, setIndex] = React.useState(initialIndex);
  const touchStartX = React.useRef<number | null>(null);
  const isWechat = /MicroMessenger/i.test(navigator.userAgent);
  const current = images[index];

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setIndex((value) => (value - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setIndex((value) => (value + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [images.length, onClose]);

  function move(direction: -1 | 1) {
    setIndex((value) => (value + direction + images.length) % images.length);
  }

  async function downloadImage() {
    try {
      const response = await fetch(current);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${title || "案例图片"}-${index + 1}.${blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(current, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="image-preview" role="dialog" aria-modal="true" aria-label="案例图片预览" onClick={onClose}>
      <header onClick={(event) => event.stopPropagation()}><button type="button" aria-label="关闭图片预览" onClick={onClose}><X size={23} /></button><span>{index + 1} / {images.length}</span>{isWechat ? <span className="wechat-save-tip">长按图片保存</span> : <button type="button" aria-label="下载当前图片" onClick={downloadImage}><Download size={21} /></button>}</header>
      <div className="image-preview-stage" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { const start = touchStartX.current; const end = event.changedTouches[0]?.clientX; touchStartX.current = null; if (start === null || end === undefined || Math.abs(end - start) < 45) return; move(end < start ? 1 : -1); }}>
        <img src={current} alt={`${title} 第 ${index + 1} 张大图`} />
        {images.length > 1 ? <><button className="image-preview-nav previous" type="button" aria-label="上一张" onClick={() => move(-1)}><ChevronLeft size={28} /></button><button className="image-preview-nav next" type="button" aria-label="下一张" onClick={() => move(1)}><ChevronRight size={28} /></button></> : null}
      </div>
      {isWechat ? <p>长按上方图片，选择“保存图片”</p> : <button className="image-preview-download" type="button" onClick={(event) => { event.stopPropagation(); void downloadImage(); }}><Download size={18} />保存图片</button>}
    </div>
  );
}

function CaseComposer({ data, session, busy, notify, runAction, onClose }: { data: PageProps["data"]; session: PageProps["session"]; busy: boolean; notify: PageProps["notify"]; runAction: PageProps["runAction"]; onClose: () => void }) {
  const [content, setContent] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [privacyConfirmed, setPrivacyConfirmed] = React.useState(false);
  const previews = React.useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  React.useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const videos = selected.filter((file) => file.type.startsWith("video/"));
    const images = selected.filter((file) => file.type.startsWith("image/"));
    const existingVideo = files.some((file) => file.type.startsWith("video/"));
    const existingImages = files.some((file) => file.type.startsWith("image/"));
    if ((videos.length && images.length) || (videos.length && existingImages) || (images.length && existingVideo)) {
      notify({ type: "error", text: "一条案例请选择图片或视频，不要混合上传" });
      return;
    }
    if (videos.length > 1 || (videos.length && files.length)) {
      notify({ type: "error", text: "一条案例最多上传一个视频" });
      return;
    }
    if (images.length + (existingImages ? files.length : 0) > 9) {
      notify({ type: "error", text: "一条案例最多上传 9 张图片" });
      return;
    }
    if (selected.some((file) => file.size > 32 * 1024 * 1024)) {
      notify({ type: "error", text: "单个文件不能超过 32MB" });
      return;
    }
    setFiles((current) => videos.length ? selected : [...current, ...images]);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  async function publish() {
    if (!privacyConfirmed || (!content.trim() && files.length === 0) || (!session && data.source !== "fallback")) return;
    const result = await runAction("publish-case", async () => {
      const uploads = await Promise.all(files.map((file) => uploadMedia(session!, file, file.type.startsWith("video/") ? "employee-web/cases/videos" : "employee-web/cases/images")));
      const video = files[0]?.type.startsWith("video/") ? uploads[0] : null;
      const images = video ? [] : uploads.map((upload, index) => ({ fileId: upload.fileID, url: upload.url, size: files[index].size }));
      return submitContent(session!, {
        type: "case",
        title: content.trim().slice(0, 24) || "门店案例分享",
        content: content.trim(),
        images,
        videoFileId: video?.fileID,
        casePrivacyConfirmed: true,
        casePrivacyVersion: data.policy.casePrivacyVersion
      });
    }, {
      demoAction: { type: "publishCase", payload: { content: content.trim(), files, casePrivacyConfirmed: true, casePrivacyVersion: data.policy.casePrivacyVersion } }
    });
    if (result) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="发布案例">
      <section className="composer-panel">
        <header><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={22} /></button><h2>发布案例</h2><button type="button" disabled={busy || !privacyConfirmed || (!content.trim() && !files.length)} onClick={publish}>发布</button></header>
        <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录顾客沟通、陈列活动或学习实践…" />
        {previews.length ? <div className={`composer-previews ${previews[0].file.type.startsWith("video/") ? "has-video" : ""}`}>{previews.map((preview, index) => <div className="composer-preview-item" key={preview.url}>{preview.file.type.startsWith("video/") ? <video controls src={preview.url} /> : <img src={preview.url} alt={`待发布案例图片 ${index + 1}`} />}<button type="button" aria-label={`移除第 ${index + 1} 个文件`} title="移除" onClick={() => removeFile(index)}><X size={16} /></button></div>)}</div> : null}
        <footer>
          <label><ImageIcon size={19} /><span>图片（可多选）</span><input type="file" accept="image/*" multiple onChange={chooseFiles} /></label>
          <label><Video size={19} /><span>视频</span><input type="file" accept="video/*" onChange={chooseFiles} /></label>
          <span>{files.length ? `已选择 ${files.length} 个文件${files[0]?.type.startsWith("image/") && files.length < 9 ? "，可继续添加" : ""}` : <><Upload size={16} />添加高清媒体</>}</span>
        </footer>
        <label className="case-privacy-confirm"><input type="checkbox" checked={privacyConfirmed} onChange={(event) => setPrivacyConfirmed(event.target.checked)} /><span>我确认内容不含顾客姓名、脸部、手机号、身份证、处方、病历、诊断结果、付款信息或其他可识别顾客的信息。</span></label>
      </section>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
