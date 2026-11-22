import { useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, FileQuestion, FileText, Gift, ListTodo, MessageSquareText, Mic2, PlayCircle, Search, Trophy, X } from "lucide-react";
import type { AppRoute, PageProps } from "../appTypes";
import { Avatar } from "../components";
import { brandConfig } from "@open-training/shared";
import type { LearningTodoGroup, LearningTodoType } from "../data";
import { learningProgressSummary, learningTodoGroups } from "../learningProgressCore.js";

const entries: Array<{ route: AppRoute; title: string; meta: string; icon: typeof BookOpen; tone: string }> = [
  { route: "learning", title: "内部资料", meta: "产品与慢病", icon: BookOpen, tone: "teal" },
  { route: "exam", title: "产品测评", meta: "完成测评", icon: FileQuestion, tone: "red" },
  { route: "phrases", title: "金句开口说", meta: "录音练习", icon: Mic2, tone: "blue" },
  { route: "ranking", title: "门店排行", meta: "查看本店", icon: Trophy, tone: "gold" }
];

const todoTypeMeta: Record<LearningTodoType, { label: string; icon: typeof BookOpen }> = {
  video: { label: "视频", icon: PlayCircle },
  material: { label: "资料", icon: FileText },
  audio: { label: "录音/开口说", icon: Mic2 },
  exam: { label: "答题/考试", icon: FileQuestion }
};

export function HomePage({ data, navigate, session, notify }: PageProps) {
  const [todoOpen, setTodoOpen] = useState(false);
  const employee = data.employee;
  const pendingCount = data.submissions.filter((item) => item.status === "pending").length;
  const progressSummary = learningProgressSummary(data, { includeSpeaking: brandConfig.features.speaking });
  const progress = progressSummary.percent;
  const todoGroups: LearningTodoGroup[] = data.isSupplier
    ? []
    : data.source === "fallback"
      ? learningTodoGroups(data, { includeSpeaking: brandConfig.features.speaking })
      : data.learningTodos.map((group) => ({ ...group, items: group.items.filter((item) => brandConfig.features.speaking || item.type !== "audio") })).filter((group) => group.items.length).map((group) => ({ ...group, count: group.items.length }));
  const todoCount = todoGroups.reduce((count, group) => count + group.items.length, 0);
  const nextTodo = todoGroups[0]?.items[0];
  const rankingIndex = data.ranking.findIndex((item) => item.id === employee.id);
  const rank = rankingIndex >= 0 ? rankingIndex + 1 : null;
  const latestCase = data.cases[0];
  const visibleEntries = entries.filter((entry) => (entry.route !== "phrases" || brandConfig.features.speaking) && (entry.route !== "ranking" || brandConfig.features.ranking));

  return (
    <div className="home-page">
      <section className="home-intro">
        <div>
          <p className="eyebrow">{employee.store || "员工学习平台"}</p>
          <h1>{greeting()}，{employee.name}</h1>
        </div>
        <Avatar employee={employee} />
      </section>

      <button className="search-entry" type="button" onClick={() => navigate("search")}>
        <Search size={18} /><span>搜索资料、测评、金句和商品</span>
      </button>

      <section className="progress-hero">
        <div className="progress-heading"><div><span>综合学习进度</span><strong>{progress}%</strong><small className="progress-completed-count">已完成 {progressSummary.completed} / {progressSummary.total} 项</small></div><button className="progress-todo-badge" type="button" onClick={() => setTodoOpen(true)} aria-label={todoCount ? `还有 ${todoCount} 项未完成学习任务` : "学习任务已全部完成"}><ListTodo size={16} /><span>{todoCount ? <>还有 <strong>{todoCount}</strong> 项</> : "全部完成"}</span></button></div>
        <div className="progress-track" aria-label={`完成进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
        <button className="next-task" type="button" onClick={() => nextTodo ? navigate(nextTodo.route) : setTodoOpen(true)}><span className="next-task-icon"><BookOpen size={20} /></span><span><small>{todoCount ? `学习提醒 · 还有 ${todoCount} 项未完成` : "学习提醒 · 当前任务已完成"}</small><b>{nextTodo?.title || "当前没有待完成任务"}</b></span><ArrowRight size={19} /></button>
      </section>

      <section className="home-section">
        <div className="section-title"><div><h2>岗位工具</h2><p>今天继续完成一项岗位任务</p></div></div>
        <div className="feature-grid">
          {visibleEntries.map((entry) => {
            const Icon = entry.icon;
            return (
              <button type="button" key={entry.route} onClick={() => navigate(entry.route)}>
                <span className={`feature-icon tone-${entry.tone}`}><Icon size={22} /></span>
                <strong>{entry.title}</strong>
                <small>{entry.meta}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-stats" aria-label="岗位工具概览">
        {brandConfig.features.ranking ? <button type="button" onClick={() => navigate("ranking")}><Trophy size={19} /><span><b>{rank ? `第 ${rank} 名` : "不参与排行"}</b><small>全员金豆排行</small></span></button> : null}
        <button type="button" onClick={() => navigate("cases")}><MessageSquareText size={19} /><span><b>{pendingCount} 个</b><small>内容待审核</small></span></button>
        {brandConfig.features.rewards ? <button type="button" onClick={() => navigate("rewards")}><Gift size={19} /><span><b>{data.rewards.length} 件</b><small>可兑换好礼</small></span></button> : null}
      </section>

      {latestCase ? (
        <section className="home-section latest-case-section">
          <div className="section-title"><div><h2>全员新案例</h2><p>来自各门店同事的最新分享</p></div><button type="button" onClick={() => navigate("cases")}>查看全部</button></div>
          <button className="latest-case" type="button" onClick={() => navigate("cases")}>
            <span className="official-dot">{latestCase.publisherRole === "admin" ? "官" : latestCase.publisherName?.slice(0, 1) || "学"}</span>
            <span><strong>{latestCase.title}</strong><small>{latestCase.content}</small></span>
            <ArrowRight size={18} />
          </button>
        </section>
      ) : null}
      {todoOpen ? <LearningTodoDetail groups={todoGroups} count={todoCount} onClose={() => setTodoOpen(false)} onNavigate={(route) => { setTodoOpen(false); navigate(route); }} /> : null}
    </div>
  );
}

function LearningTodoDetail({ groups, count, onClose, onNavigate }: { groups: LearningTodoGroup[]; count: number; onClose: () => void; onNavigate: (route: AppRoute) => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="未完成学习任务" onClick={onClose}>
      <section className="policy-modal learning-todo-modal" onClick={(event) => event.stopPropagation()}>
        <header><div><h2>未完成学习任务</h2><p>{count ? `还有 ${count} 项，完成后会自动从清单移除` : "当前所有学习任务均已完成"}</p></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>
        {groups.length ? <div className="learning-todo-groups">
          {groups.map((group) => (
            <section className="learning-todo-group" key={group.productKey}>
              <header><h3>{group.productName}</h3><span>{group.items.length} 项</span></header>
              <div>
                {group.items.map((item) => {
                  const meta = todoTypeMeta[item.type];
                  const Icon = meta.icon;
                  const progress = Math.max(0, Math.min(100, Number(item.progress || 0)));
                  return <button className="learning-todo-item" type="button" key={item.id} onClick={() => onNavigate(item.route)}><span className={`learning-todo-icon type-${item.type}`}><Icon size={18} /></span><span><strong>{item.title}</strong><small>{meta.label} · {item.status}{progress > 0 ? ` · ${progress}%` : ""}</small></span><ChevronRight size={17} /></button>;
                })}
              </div>
            </section>
          ))}
        </div> : <div className="learning-todo-empty"><CheckCircle2 size={30} /><strong>学习任务已全部完成</strong><span>暂无需要处理的视频、资料、录音或答题</span></div>}
        <button className="primary-button full-button" type="button" onClick={onClose}>关闭</button>
      </section>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
