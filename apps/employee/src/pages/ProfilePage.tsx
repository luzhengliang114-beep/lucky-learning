import React from "react";
import { brandConfig } from "@open-training/shared";
import { BookOpenCheck, ChevronRight, FileText, LogOut, Medal, Mic2, PackageCheck, RotateCcw, ShieldCheck, Sparkles, Trash2, TriangleAlert, UserRoundCheck, X } from "lucide-react";
import { deleteRecording } from "../data";
import type { PageProps } from "../appTypes";
import { Avatar, BeanBadge, EmptyState, PageHeader, SegmentedControl, StatusPill } from "../components";

type RecordTab = "learning" | "submissions" | "redemptions";
type PolicyView = "privacy" | "recording" | "internal" | "deletion" | "";

export function ProfilePage(props: PageProps & { onLogout: () => void; onResetDemo: () => void }) {
  const { data, session, busy, navigate, runAction, onLogout, onResetDemo } = props;
  const [recordTab, setRecordTab] = React.useState<RecordTab>("learning");
  const [resetConfirming, setResetConfirming] = React.useState(false);
  const [policyView, setPolicyView] = React.useState<PolicyView>("");
  const rankingIndex = data.ranking.findIndex((item) => item.id === data.employee.id);
  const rank = rankingIndex >= 0 ? rankingIndex + 1 : null;

  async function removeRecording(fileId: string) {
    if (!window.confirm("确认删除这条原始录音吗？练习结果和金豆记录会继续保留。")) return;
    await runAction(`delete-recording-${fileId}`, () => deleteRecording(session!, fileId), {
      demoAction: { type: "deleteRecording", payload: { fileId } }
    });
  }

  return (
    <div>
      <PageHeader title="我的" subtitle="完成记录与员工资料" onBack={() => navigate("home")} />
      <section className="profile-hero">
        <Avatar employee={data.employee} size="large" />
        <div><h2>{data.employee.name}</h2><p>{data.employee.store} · {data.employee.employeeNo}</p></div>
        <BeanBadge value={data.employee.goldenBeans} />
      </section>

      <section className="profile-stats">
        <div><strong>{data.employee.courseCompletionRate}%</strong><small>综合完成率</small></div><div><strong>{data.employee.examPassRate}%</strong><small>测评通过率</small></div><div><strong>{rank ? `第 ${rank} 名` : "不参与排名"}</strong><small>门店排名</small></div>
      </section>

      <section className="settings-panel profile-managed-panel">
        <div className="section-title"><div><h2>员工资料</h2><p>姓名和所属门店由{brandConfig.headquartersName}统一维护，如需修改请联系管理员。</p></div></div>
        <dl className="profile-managed-fields">
          <div><dt>姓名</dt><dd>{data.employee.name}</dd></div>
          <div><dt>所属门店/部门</dt><dd>{data.employee.store || "-"}</dd></div>
        </dl>
        {data.source === "fallback" ? (
          <div className="demo-reset-control">
            {resetConfirming ? <div className="demo-reset-confirm"><TriangleAlert size={18} /><span>确认清除全部演示进度？</span><button type="button" onClick={() => setResetConfirming(false)}>取消</button><button type="button" className="danger" disabled={busy === "demo-reset"} onClick={onResetDemo}>{busy === "demo-reset" ? "重置中" : "确认重置"}</button></div>
              : <button className="demo-reset-button" type="button" onClick={() => setResetConfirming(true)}><RotateCcw size={17} />重置演示数据</button>}
          </div>
        ) : null}
      </section>

      <section className="profile-shortcuts">
        {brandConfig.features.ranking ? <button type="button" onClick={() => navigate("ranking")}><span><Medal size={19} /></span><div><strong>全员排行榜</strong><small>查看全体员工金豆排名</small></div><ChevronRight size={18} /></button> : null}
        {brandConfig.features.rewards ? <button type="button" onClick={() => navigate("rewards")}><span><Sparkles size={19} /></span><div><strong>金豆明细</strong><small>{data.goldenBeanLedger.length} 条收支记录</small></div><ChevronRight size={18} /></button> : null}
        <button type="button" onClick={() => navigate("boundary")}><span><ShieldCheck size={19} /></span><div><strong>工具边界与使用规范</strong><small>内部员工使用范围与内容责任</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={() => setPolicyView("privacy")}><span><UserRoundCheck size={19} /></span><div><strong>个人信息告知</strong><small>查看身份信息的处理方式</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={() => setPolicyView("recording")}><span><Mic2 size={19} /></span><div><strong>录音使用说明</strong><small>查看录音用途和访问范围</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={() => setPolicyView("internal")}><span><ShieldCheck size={19} /></span><div><strong>内部使用规则</strong><small>培训内容仅限{brandConfig.shortName}员工</small></div><ChevronRight size={18} /></button>
        <button type="button" onClick={() => setPolicyView("deletion")}><span><Trash2 size={19} /></span><div><strong>数据删除说明</strong><small>查看名单和录音删除规则</small></div><ChevronRight size={18} /></button>
      </section>

      {brandConfig.features.speaking ? <section className="record-section recording-management">
        <div className="section-title"><div><h2>我的原始录音</h2><p>删除录音不会清除练习结果和金豆流水</p></div></div>
        {data.recordings.length ? <div className="record-list">{data.recordings.map((recording) => <article key={recording.id}><span className="record-icon"><Mic2 size={19} /></span><div><strong>{recording.title}</strong><small>{formatDate(recording.createdAt)}</small></div><button className="record-delete-button" type="button" aria-label={`删除 ${recording.title}`} title="删除原始录音" disabled={busy === `delete-recording-${recording.fileId}`} onClick={() => removeRecording(recording.fileId)}><Trash2 size={17} /></button></article>)}</div> : <EmptyState title="没有保留的原始录音" text="完成开口说练习后，可在这里管理录音" />}
      </section> : null}

      {brandConfig.features.rewards ? <section className="record-section profile-records">
        <SegmentedControl value={recordTab} options={[{ value: "learning", label: "完成记录" }, { value: "submissions", label: "内容提交" }, { value: "redemptions", label: "兑换记录" }]} onChange={setRecordTab} />
        <ProfileRecords tab={recordTab} data={data} />
      </section> : null}

      <button className="logout-button" type="button" disabled={busy === "logout"} onClick={onLogout}><LogOut size={18} />退出登录</button>
      {policyView ? <PolicyDialog kind={policyView} contact={data.policy.privacyContact} onClose={() => setPolicyView("")} /> : null}
    </div>
  );
}

function PolicyDialog({ kind, contact, onClose }: { kind: Exclude<PolicyView, "">; contact: string; onClose: () => void }) {
  const content = {
    privacy: { title: "个人信息告知", paragraphs: [`${brandConfig.name}会处理登录身份标识、姓名和所属门店；接入微信授权后还会处理微信昵称和头像，用于与${brandConfig.headquartersName}预录入名单匹配、登录和内部学习记录管理。`, `如需查询、更正或删除个人信息，请联系：${contact || brandConfig.privacyContact}`] },
    recording: { title: "录音使用说明", paragraphs: ["录音仅用于员工话术练习、语音识别和完成结果判断，仅本人和有审核权限的管理员可以访问。", "你可以删除原始录音；删除后练习结果、审核记录和金豆流水继续保留。员工停用后，录音默认在 90 天后进入删除范围。"] },
    internal: { title: "内部使用规则", paragraphs: [`课程、题库、话术、案例和排行榜仅用于${brandConfig.name}员工内部培训，不应向无关人员传播。`, "系统内容不替代药品说明书、执业药师判断或顾客就医建议。"] },
    deletion: { title: "数据删除说明", paragraphs: [`员工名单和身份绑定由${brandConfig.headquartersName}统一管理。`, "原始录音可在本页逐条删除。删除失败时系统会标记重试，并明确提示尚未完成。"] }
  }[kind];
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={content.title}><section className="policy-modal"><header><h2>{content.title}</h2><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>{content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<button className="primary-button full-button" type="button" onClick={onClose}>关闭</button></section></div>;
}

function ProfileRecords({ tab, data }: { tab: RecordTab; data: PageProps["data"] }) {
  if (tab === "learning") {
    const courses = data.courses.filter((course) => course.completed || Number(course.progress || 0) > 0);
    return courses.length ? <div className="record-list">{courses.map((course) => <article key={course.id}><span className="record-icon"><BookOpenCheck size={19} /></span><div><strong>{course.title}</strong><small>{course.completed ? "已完成" : `已完成 ${course.progress || 0}%`}</small></div>{course.completed ? <StatusPill status="approved" /> : null}</article>)}</div> : <EmptyState title="还没有完成记录" text="进入内部资料完成第一项内容" />;
  }
  if (tab === "submissions") {
    return data.submissions.length ? <div className="record-list">{data.submissions.map((item) => <article key={item.id}><span className="record-icon"><FileText size={19} /></span><div><strong>{item.title}</strong><small>{formatDate(item.createdAt)} · {item.type === "phrase" ? "开口说" : "案例"}</small></div><StatusPill status={item.status} /></article>)}</div> : <EmptyState title="还没有内容提交" text="录制金句或分享案例后会显示在这里" />;
  }
  return data.redemptions.length ? <div className="record-list">{data.redemptions.map((item) => <article key={item.id}><span className="record-icon"><PackageCheck size={19} /></span><div><strong>兑换 {item.goldenBeanCost} 金豆奖励</strong><small>{formatDate(item.createdAt)}</small></div><StatusPill status={item.status} /></article>)}</div> : <EmptyState title="还没有兑换记录" text="金豆可在好礼页面兑换奖励" />;
}

function formatDate(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}
