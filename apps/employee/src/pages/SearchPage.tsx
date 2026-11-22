import React from "react";
import { BookOpen, FileQuestion, Gift, Mic2, Search, X } from "lucide-react";
import type { AppRoute, PageProps } from "../appTypes";
import { EmptyState, PageHeader } from "../components";
import { brandConfig } from "@open-training/shared";

type SearchItem = { id: string; title: string; meta: string; route: AppRoute; icon: typeof BookOpen; keywords: string };

export function SearchPage({ data, navigate }: PageProps) {
  const [query, setQuery] = React.useState("");
  const items: SearchItem[] = [
    ...data.courses.map((item) => ({ id: `course-${item.id}`, title: item.title, meta: item.productName || "内部资料", route: "learning" as const, icon: BookOpen, keywords: `${item.title} ${item.description} ${item.productName || ""}` })),
    ...data.exams.map((item) => ({ id: `exam-${item.id}`, title: item.title, meta: `${item.passScore} 分通过`, route: "exam" as const, icon: FileQuestion, keywords: `${item.title} ${item.productName || ""}` })),
    ...(brandConfig.features.speaking ? data.phrases.map((item) => ({ id: `phrase-${item.id}`, title: item.title, meta: item.productName || "开口说", route: "phrases" as const, icon: Mic2, keywords: `${item.title} ${item.script} ${item.productName || ""}` })) : []),
    ...(brandConfig.features.rewards ? data.rewards.map((item) => ({ id: `reward-${item.id}`, title: item.title, meta: `${item.goldenBeanPrice} 金豆`, route: "rewards" as const, icon: Gift, keywords: `${item.title} ${item.description}` })) : [])
  ];
  const normalized = query.trim().toLowerCase();
  const results = normalized ? items.filter((item) => item.keywords.toLowerCase().includes(normalized)) : items.slice(0, 8);

  return (
    <div>
      <PageHeader title="全局搜索" subtitle="资料、测评、金句与兑换商品" onBack={() => navigate("home")} />
      <label className="search-field">
        <Search size={19} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={18} /></button> : null}
      </label>
      <div className="search-caption">{normalized ? `找到 ${results.length} 条结果` : "最近可用内容"}</div>
      {results.length ? (
        <div className="search-results">
          {results.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} onClick={() => navigate(item.route)}><span><Icon size={19} /></span><div><strong>{item.title}</strong><small>{item.meta}</small></div></button>;
          })}
        </div>
      ) : <EmptyState icon={<Search size={24} />} title="没有找到相关内容" text="换一个产品名或岗位关键词试试" />}
    </div>
  );
}
