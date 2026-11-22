import React from "react";
import {
  BookOpen,
  Camera,
  ChevronLeft,
  CircleUserRound,
  Gift,
  Home,
  MessageSquareText,
  Search,
  Sparkles
} from "lucide-react";
import { brandAssetUrl, brandConfig } from "@open-training/shared";
import type { Employee } from "@open-training/shared";
import type { AppRoute, Notice } from "./appTypes";
import { caseUnreadLabel } from "./caseUnreadCore.js";

export function Avatar({ employee, size = "normal" }: { employee: Pick<Employee, "name" | "avatarUrl">; size?: "small" | "normal" | "large" }) {
  return (
    <span className={`avatar avatar-${size}`} aria-label={`${employee.name}的头像`}>
      {employee.avatarUrl ? <img src={employee.avatarUrl} alt="" /> : employee.name.slice(0, 1)}
    </span>
  );
}

export function TopBar({ employee, onSearch, onProfile }: { employee: Employee; onSearch: () => void; onProfile: () => void }) {
  return (
    <header className="top-bar">
      <button className="brand-button" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <img className="brand-logo" src={brandAssetUrl(brandConfig.logo)} alt="" />
        <span><strong>{brandConfig.shortName}</strong><small>{brandConfig.employeeSubtitle}</small></span>
      </button>
      <div className="top-actions">
        <button className="icon-button" type="button" aria-label="搜索" title="搜索" onClick={onSearch}><Search size={20} /></button>
        <button className="avatar-button" type="button" aria-label="我的资料" onClick={onProfile}><Avatar employee={employee} size="small" /></button>
      </div>
    </header>
  );
}

const navItems: Array<{ route: AppRoute; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { route: "home", label: "首页", icon: Home },
  { route: "cases", label: "案例", icon: MessageSquareText },
  { route: "rewards", label: "金豆", icon: Gift },
  { route: "profile", label: "我的", icon: CircleUserRound }
];

export function BottomNav({ route, navigate, caseUnreadCount = 0, onReceiptCapture }: { route: AppRoute; navigate: (route: AppRoute) => void; caseUnreadCount?: number; onReceiptCapture?: (files: File[]) => void }) {
  const captureInputRef = React.useRef<HTMLInputElement | null>(null);

  function handleCaptureChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    if (files.length) onReceiptCapture?.(files);
    event.target.value = "";
  }

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {navItems.slice(0, 2).map((item) => {
        const Icon = item.icon;
        const active = item.route === route;
        const unreadLabel = item.route === "cases" ? caseUnreadLabel(caseUnreadCount) : "";
        return (
          <button className={active ? "active" : ""} type="button" key={item.route} onClick={() => navigate(item.route)} aria-current={active ? "page" : undefined} aria-label={unreadLabel ? `${item.label}，${caseUnreadCount} 项未接收` : item.label}>
            <span className="bottom-nav-icon"><Icon size={21} />{unreadLabel ? <b className="case-unread-badge" aria-hidden="true">{unreadLabel}</b> : null}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
      {brandConfig.features.rewards ? <button className="bottom-nav-capture" type="button" onClick={() => captureInputRef.current?.click()} aria-label="拍照识别" title="拍照识别">
        <span className="bottom-nav-capture-icon"><Camera size={22} /></span>
        <span>拍照识别</span>
      </button> : null}
      {navItems.slice(2).filter((item) => item.route !== "rewards" || brandConfig.features.rewards).map((item) => {
        const Icon = item.icon;
        const active = item.route === route;
        return (
          <button className={active ? "active" : ""} type="button" key={item.route} onClick={() => navigate(item.route)} aria-current={active ? "page" : undefined} aria-label={item.label}>
            <span className="bottom-nav-icon"><Icon size={21} /></span>
            <span>{item.label}</span>
          </button>
        );
      })}
      {brandConfig.features.rewards ? <input className="receipt-file-input" ref={captureInputRef} type="file" accept="image/*" multiple aria-label="拍照识别销售小票" onChange={handleCaptureChange} /> : null}
    </nav>
  );
}

export function PageHeader({ title, subtitle, onBack, action }: { title: string; subtitle?: string; onBack?: () => void; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        {onBack ? <button className="icon-button back-button" type="button" aria-label="返回" title="返回" onClick={onBack}><ChevronLeft size={22} /></button> : null}
        <div className="page-heading-copy">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="page-header-action">{action}</div> : null}
      </div>
    </header>
  );
}

export function BeanBadge({ value }: { value: number }) {
  return <span className="bean-badge"><Sparkles size={15} />{value} 金豆</span>;
}

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div className={`notice-bar notice-${notice.type}`} role="status">
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

export function EmptyState({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>{icon || <BookOpen size={24} />}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = { pending: "待审核", approved: "已通过", published: "已发布", rejected: "未通过", fulfilled: "已发放" };
  return <span className={`status-pill status-${status}`}>{labels[status] || status}</span>;
}

export function SegmentedControl<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="segmented-control">
      {options.map((option) => <button className={option.value === value ? "active" : ""} type="button" key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  );
}
