import React from "react";
import { ArrowRight, CheckCircle2, Mic2, RotateCcw, ShieldCheck, Sparkles, Square, Upload, Volume2 } from "lucide-react";
import { acceptRecordingNotice, recognizePhrase, uploadMedia } from "../data";
import type { PageProps } from "../appTypes";
import { BeanBadge, EmptyState, PageHeader } from "../components";
import { convertRecordingToWav } from "../recordingAudio";
import { applyPhraseResult } from "../quickActionStateCore.js";

type AppPhrase = PageProps["data"]["phrases"][number];

export function PhrasesPage({ data, session, busy, navigate, notify, runAction }: PageProps) {
  const [product, setProduct] = React.useState("");
  const [phrase, setPhrase] = React.useState<AppPhrase | null>(null);
  const groups = groupPhrases(data.phrases);
  const currentGroup = groups.find((group) => group.product === product);

  function back() {
    if (phrase) return setPhrase(null);
    if (product) return setProduct("");
    navigate("home");
  }

  if (phrase) {
    const currentPhrase = data.phrases.find((item) => item.id === phrase.id) || phrase;
    const attempts = currentPhrase.completedCount ?? data.submissions.filter((item) => item.type === "phrase" && item.phraseId === currentPhrase.id && item.status === "approved").length;
    return <PhraseRecorder phrase={currentPhrase} attempts={attempts} data={data} session={session} busy={busy} notify={notify} runAction={runAction} onBack={back} />;
  }

  return (
    <div>
      <PageHeader title={currentGroup ? currentGroup.product : "金句开口说"} subtitle={currentGroup ? `${currentGroup.phrases.length} 条实战话术` : "反复练习，让表达更自然"} onBack={back} action={<BeanBadge value={data.employee.goldenBeans} />} />
      {!currentGroup ? (
        groups.length ? <div className="phrase-collections">{groups.map((group, index) => (
          <button type="button" key={group.product} onClick={() => setProduct(group.product)}>
            <span className={`phrase-collection-art phrase-tone-${index % 3}`}><Mic2 size={28} /></span>
            <span><strong>{group.product}</strong><small>{phraseTaskText(group.taskStatus)} · {group.phrases.length} 条金句 · 共 {group.totalBeans} 金豆</small></span>
            <ArrowRight size={19} />
          </button>
        ))}</div> : <EmptyState title="暂无金句话术" text="后台发布话术后会显示在这里" />
      ) : (
        <div className="phrase-list">{currentGroup.phrases.map((item, index) => {
          const attempts = item.completedCount ?? data.submissions.filter((submission) => submission.type === "phrase" && submission.phraseId === item.id && submission.status === "approved").length;
          return (
            <button type="button" key={item.id} onClick={() => setPhrase(item)}>
              <span className="phrase-number">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{item.title}</strong><small>{item.script}</small><i>{attempts}/{item.maxRewardedAttempts || 1} 次已完成</i></span>
              {attempts >= (item.maxRewardedAttempts || 1) ? <CheckCircle2 className="passed-icon" size={20} /> : <ArrowRight size={19} />}
            </button>
          );
        })}</div>
      )}
    </div>
  );
}

function PhraseRecorder({ phrase, attempts, data, session, busy, notify, runAction, onBack }: { phrase: AppPhrase; attempts: number; data: PageProps["data"]; session: PageProps["session"]; busy: string; notify: PageProps["notify"]; runAction: PageProps["runAction"]; onBack: () => void }) {
  const [recording, setRecording] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = React.useState("");
  const [processingAudio, setProcessingAudio] = React.useState(false);
  const [recordingNoticeOpen, setRecordingNoticeOpen] = React.useState(false);
  const [acceptingNotice, setAcceptingNotice] = React.useState(false);
  const [noticeAccepted, setNoticeAccepted] = React.useState(() => (
    data.employee.recordingNoticeVersion === data.policy.recordingNoticeVersion
    || window.sessionStorage.getItem("employee-recording-notice") === data.policy.recordingNoticeVersion
  ));
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const maxAttempts = phrase.maxRewardedAttempts || 1;

  React.useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }

  function requestRecording() {
    if (!noticeAccepted) {
      setRecordingNoticeOpen(true);
      return;
    }
    void startRecording();
  }

  async function confirmRecordingNotice() {
    setAcceptingNotice(true);
    try {
      if (data.source !== "fallback") {
        if (!session) throw new Error("登录状态已失效，请重新进入");
        await acceptRecordingNotice(session, data.policy.recordingNoticeVersion);
      }
      setNoticeAccepted(true);
      window.sessionStorage.setItem("employee-recording-notice", data.policy.recordingNoticeVersion);
      setRecordingNoticeOpen(false);
      notify({ type: "success", text: "录音使用说明已确认" });
    } catch (error) {
      notify({ type: "error", text: error instanceof Error ? error.message : "录音说明确认失败" });
    } finally {
      setAcceptingNotice(false);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      notify({ type: "error", text: "当前微信版本不支持网页录音，请升级后重试" });
      return;
    }
    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const recordedBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        setProcessingAudio(true);
        try {
          const nextBlob = await convertRecordingToWav(recordedBlob);
          if (nextBlob.size > 3 * 1024 * 1024) throw new Error("录音文件过大，请缩短后重试");
          setBlob(nextBlob);
          setAudioUrl(URL.createObjectURL(nextBlob));
        } catch (error) {
          setBlob(null);
          setAudioUrl("");
          notify({ type: "error", text: error instanceof Error ? error.message : "录音处理失败，请重新录音" });
        } finally {
          setProcessingAudio(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setBlob(null);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((value) => {
        const next = Math.min(60, value + 1);
        if (next >= 60) window.setTimeout(stopRecording, 0);
        return next;
      }), 1000);
    } catch (error) {
      notify({ type: "error", text: (error as Error).name === "NotAllowedError" ? "需要允许麦克风权限才能录音" : "录音启动失败，请稍后重试" });
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  }

  function resetRecording() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    setBlob(null);
    setSeconds(0);
  }

  async function submitRecording() {
    if (!blob || (!session && data.source !== "fallback")) return;
    if (seconds < 2) {
      notify({ type: "error", text: "录音至少需要 2 秒，请重新录制" });
      return;
    }
    const result = await runAction(`phrase-${phrase.id}`, async () => {
      const upload = await uploadMedia(session!, blob, "employee-web/recordings");
      return recognizePhrase(session!, phrase.id, upload.fileID);
    }, {
      demoAction: { type: "submitPhrase", payload: { phraseId: phrase.id, duration: seconds, blob } },
      refreshMode: "background",
      applyResult: (current, actionResult) => applyPhraseResult(current, phrase.id, actionResult.data)
    });
    if (result) resetRecording();
  }

  return (
    <div>
      <PageHeader title={phrase.title} subtitle={phrase.productName || "金句开口说"} onBack={onBack} action={<BeanBadge value={data.employee.goldenBeans} />} />
      <section className="phrase-script">
        <span>练习话术</span>
        <blockquote>{phrase.script}</blockquote>
        <div><span><Sparkles size={16} />每次 {phrase.goldenBeans} 金豆</span><span>已完成 {attempts}/{maxAttempts} 次</span></div>
      </section>

      {phrase.audioUrl ? (
        <section className="reference-audio">
          <span><Volume2 size={16} />标准示范录音</span>
          <audio controls preload="metadata" src={phrase.audioUrl} />
        </section>
      ) : null}

      <section className={`recorder-panel ${recording ? "is-recording" : ""}`}>
        <div className="sound-wave" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: `${12 + (index * 13) % 34}px` }} />)}</div>
        <strong>{recording ? formatTime(seconds) : processingAudio ? "正在处理录音" : blob ? "录音已准备" : "点击开始录音"}</strong>
        <p>{recording ? `${seconds >= 60 ? "已到最长时间" : "正在录制"} · 最长 60 秒` : processingAudio ? "正在准备语音识别格式" : blob ? `${formatTime(seconds)} · 可以试听或重新录制` : "保持自然语速，完整说出上方话术"}</p>
        {recording ? <button className="record-button stop" type="button" onClick={stopRecording}><Square size={22} fill="currentColor" /><span>结束</span></button> : <button className="record-button" type="button" disabled={processingAudio} onClick={requestRecording}><Mic2 size={26} /><span>{blob ? "重录" : "录音"}</span></button>}
      </section>

      {audioUrl ? <div className="audio-review"><audio controls src={audioUrl} /><button className="icon-button" type="button" aria-label="重新录制" title="重新录制" onClick={resetRecording}><RotateCcw size={19} /></button></div> : null}
      <button className="primary-button full-button phrase-submit" type="button" disabled={!blob || processingAudio || busy === `phrase-${phrase.id}`} onClick={submitRecording}><Upload size={18} />{busy === `phrase-${phrase.id}` ? "识别中" : "提交录音"}</button>
      {recordingNoticeOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="录音使用说明">
          <section className="policy-modal recording-notice-modal">
            <span className="policy-icon"><ShieldCheck size={23} /></span>
            <h2>录音使用说明</h2>
            <p>录音仅用于员工话术练习、语音识别和完成结果判断。只有你本人和有审核权限的管理员可以访问原始录音。</p>
            <p>你可以在“我的”页面删除原始录音。删除后练习结果、审核记录和已经产生的金豆流水仍会保留；员工账号停用后，原始录音默认在 90 天后进入删除范围。</p>
            <div className="policy-actions"><button type="button" onClick={() => setRecordingNoticeOpen(false)}>暂不录音</button><button className="confirm" type="button" disabled={acceptingNotice} onClick={confirmRecordingNotice}>{acceptingNotice ? "确认中" : "同意并继续"}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function groupPhrases(phrases: AppPhrase[]) {
  const map = new Map<string, { phrases: AppPhrase[]; taskStatus?: AppPhrase["taskStatus"] }>();
  phrases.forEach((phrase) => {
    const product = phrase.productName || "通用话术";
    const group = map.get(product) || { phrases: [], taskStatus: phrase.taskStatus };
    group.phrases.push(phrase);
    map.set(product, group);
  });
  return [...map.entries()].map(([product, group]) => ({
    product,
    taskStatus: group.taskStatus,
    phrases: group.phrases.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    totalBeans: group.phrases.reduce((sum, phrase) => sum + phrase.goldenBeans * (phrase.maxRewardedAttempts || 1), 0)
  }));
}

function phraseTaskText(status: AppPhrase["taskStatus"]) {
  return status === "completed" ? "任务已完成，不强制开口说" : status === "learning-required" ? "需完成开口说" : "开口说不强制";
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
