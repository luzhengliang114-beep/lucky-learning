import React from "react";
import { AlertCircle, LoaderCircle, LogOut, MessageCircleMore, RefreshCw, Smartphone } from "lucide-react";
import { brandAssetUrl, brandConfig, exactOrganizationMatch, filterOrganizations, groupOrganizationsByBrand, organizationTypeLabel } from "@open-training/shared";
import type { Brand } from "@open-training/shared";
import {
  bindEmployee,
  bootstrapAuth,
  completeDemoBindingRehearsal,
  enableDemoMode,
  directLogin,
  flushPendingVideoWatchProgress,
  loadEmployeeData,
  logoutSession,
  recoverExpiredDemoRehearsal
} from "./data";
import { clearLogoutMarker } from "./logoutStateCore.js";
import { caseUnreadCount } from "./caseUnreadCore.js";
import type { ActionResult, AuthResult, EmployeeAppData, EmployeeSession } from "./data";
import type { Notice, RefreshOptions, RunActionOptions } from "./appTypes";
import { createRefreshCoordinator } from "./refreshCoordinatorCore.js";
import { BottomNav, NoticeBar, TopBar } from "./components";
import { useHashRoute } from "./useHashRoute";
import { CasesPage } from "./pages/CasesPage";
import { ExamPage } from "./pages/ExamPage";
import { HomePage } from "./pages/HomePage";
import { LearningPage } from "./pages/LearningPage";
import { PhrasesPage } from "./pages/PhrasesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RankingPage } from "./pages/RankingPage";
import { RewardsPage } from "./pages/RewardsPage";
import { SearchPage } from "./pages/SearchPage";
import { BoundaryPage } from "./pages/BoundaryPage";

type AppStatus = "loading" | "wechat-only" | "binding" | "ready" | "logged-out" | "error";

let bootstrapPromise: ReturnType<typeof bootstrapAuth> | null = null;

function startBootstrap() {
  if (!bootstrapPromise) bootstrapPromise = bootstrapAuth();
  return bootstrapPromise;
}

export function App() {
  const { route, navigate } = useHashRoute();
  const [status, setStatus] = React.useState<AppStatus>("loading");
  const [data, setData] = React.useState<EmployeeAppData | null>(null);
  const [session, setSession] = React.useState<EmployeeSession | null>(null);
  const [auth, setAuth] = React.useState<AuthResult | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [busy, setBusy] = React.useState("");
  const [bootError, setBootError] = React.useState("");
  const [receiptCaptureFiles, setReceiptCaptureFiles] = React.useState<File[] | null>(null);
  const refreshCoordinatorRef = React.useRef(createRefreshCoordinator<EmployeeAppData>());

  const initialize = React.useCallback(async () => {
    setStatus("loading");
    setBootError("");
    try {
      const result = await startBootstrap();
      if (result.status === "logged-out") {
        setData(null);
        setSession(null);
        setAuth(null);
        setStatus("logged-out");
        return;
      }
      if (result.status === "demo" || result.status === "bound") {
        setData(result.data || null);
        setSession(result.auth?.session || null);
        setStatus("ready");
        return;
      }
      if (result.status === "bind" && result.auth && (result.auth.session || result.auth.demoBinding || result.auth.directEntry || result.auth.manualEntry)) {
        setAuth(result.auth);
        setSession(result.auth.session || null);
        setStatus("binding");
        return;
      }
      setStatus("wechat-only");
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "进入岗位工具失败");
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (!session || !data || data.source !== "cloudbase" || data.isSupplier) return;
    void flushPendingVideoWatchProgress(session, data.employee.id)
      .then(() => refresh())
      .catch(() => undefined);
  }, [data?.employee.id, data?.isSupplier, data?.source, session?.sessionToken]);

  React.useEffect(() => {
    if (data?.source !== "fallback") return undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    import("./demoStore").then(({ subscribeDemoData }) => {
      if (active) unsubscribe = subscribeDemoData(setData);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [data?.source]);

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  React.useEffect(() => {
    if ((route === "phrases" && !brandConfig.features.speaking)
      || (route === "rewards" && !brandConfig.features.rewards)
      || (route === "ranking" && !brandConfig.features.ranking)) {
      window.location.hash = "/home";
    }
  }, [route]);

  async function refresh(options: RefreshOptions = {}) {
    if (!session || data?.source === "fallback") return;
    return refreshCoordinatorRef.current.refresh(
      () => loadEmployeeData(session),
      (nextData) => setData(nextData),
      options
    );
  }

  async function recordLearningProgress(courseId: string, resourceType: "video" | "ppt") {
    if (!data || data.isSupplier) return undefined;
    if (data.source === "fallback") {
      const { recordDemoCourseLearningProgress } = await import("./demoStore");
      const nextData = await recordDemoCourseLearningProgress(courseId, resourceType);
      setData(nextData);
      return nextData;
    }
    return refresh();
  }

  async function runAction(
    key: string,
    action: () => Promise<ActionResult>,
    options: RunActionOptions = {}
  ) {
    if (!data) return undefined;
    if (data.isSupplier) {
      setNotice({ type: "error", text: "供应商账号仅可查看总部授权产品，不能修改学习记录或提交内容。" });
      return undefined;
    }
    setBusy(key);
    setNotice(null);
    try {
      if (data.source === "fallback") {
        if (!options.demoAction) throw new Error("演示操作尚未配置");
        const { runDemoAction } = await import("./demoStore");
        const demoResult = await runDemoAction(options.demoAction);
        setData(demoResult.nextData);
        const result = { message: demoResult.message, data: demoResult.data };
        setNotice({ type: "success", text: result.message });
        return result;
      }
      const result = await action();
      refreshCoordinatorRef.current.invalidate();
      if (options.applyResult) {
        setData((current) => current ? options.applyResult!(current, result) : current);
      }
      if (options.refreshMode === "background") {
        void refresh({ fresh: true }).catch(() => undefined);
      } else if (options.refreshMode !== "none") {
        await refresh({ fresh: true });
      }
      setNotice({ type: "success", text: result.message });
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : "操作失败，请稍后重试";
      setNotice({ type: "error", text });
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function handleBind(storeId: string, name: string, noticeVersion: string) {
    setBusy("bind");
    setNotice(null);
    try {
      if (auth?.demoBinding) {
        const { bindDemoEmployee } = await import("./demoStore");
        const result = await bindDemoEmployee(storeId, name);
        completeDemoBindingRehearsal();
        setData(result.nextData);
        setStatus("ready");
        setNotice({ type: "success", text: result.message });
        return;
      }
      if (auth?.directEntry) {
        const result = await directLogin(storeId, name);
        setSession(result.session);
        const nextData = await loadEmployeeData(result.session);
        setData(nextData);
        setStatus("ready");
        setAuth({
          ...auth,
          session: result.session,
          bound: true,
          employee: result.employee || null,
          stores: result.stores || auth.stores
        });
        setNotice({ type: "success", text: result.message });
        return;
      }
      if (!session) return;
      const result = await bindEmployee(session, storeId, name, noticeVersion);
      if (result.data?.bound !== true) throw new Error("总部员工名单中未找到该员工，请核对完整姓名和门店。");
      const nextData = await loadEmployeeData(session);
      setData(nextData);
      setAuth({ ...auth!, ...result.data, session, stores: auth?.stores || [] });
      setStatus("ready");
      setNotice({ type: "success", text: result.message });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "登录失败" });
    } finally {
      setBusy("");
    }
  }

  function handleLogout() {
    setBusy("logout");
    void logoutSession(session);
    bootstrapPromise = null;
    window.location.hash = "/home";
    setData(null);
    setSession(null);
    setAuth(null);
    setStatus("logged-out");
    setBusy("");
  }

  function handleResumeLogin() {
    const url = new URL(window.location.href);
    url.search = clearLogoutMarker(url.search);
    window.history.replaceState({}, document.title, url);
    bootstrapPromise = null;
    initialize();
  }

  async function handleResetDemo() {
    setBusy("demo-reset");
    setNotice(null);
    try {
      const { resetDemoData } = await import("./demoStore");
      const nextData = await resetDemoData();
      setData(nextData);
      setNotice({ type: "success", text: "演示数据已恢复" });
      navigate("home");
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "演示数据重置失败" });
    } finally {
      setBusy("");
    }
  }

  function retryBootstrap() {
    bootstrapPromise = null;
    recoverExpiredDemoRehearsal();
    initialize();
  }

  function handleReceiptCapture(files: File[]) {
    setReceiptCaptureFiles(files);
    navigate("rewards");
  }

  if (status === "loading") return <LoadingView />;
  if (status === "wechat-only") return <WechatOnlyView />;
  if (status === "logged-out") return <LoggedOutView onLogin={handleResumeLogin} />;
  if (status === "error") return <ErrorView message={bootError} onRetry={retryBootstrap} />;
  if (status === "binding" && auth) return <BindingView auth={auth} busy={busy === "bind"} notice={notice} onBind={handleBind} />;
  if (!data) return <ErrorView message="员工数据暂时不可用" onRetry={() => { bootstrapPromise = null; initialize(); }} />;

  const pageProps = { data, session, busy, navigate, receiptCaptureFiles, onReceiptCaptureHandled: () => setReceiptCaptureFiles(null), notify: setNotice, clearNotice: () => setNotice(null), refresh, recordLearningProgress, runAction };
  const pages = {
    home: <HomePage {...pageProps} />,
    learning: <LearningPage {...pageProps} />,
    exam: <ExamPage {...pageProps} />,
    phrases: <PhrasesPage {...pageProps} />,
    cases: <CasesPage {...pageProps} />,
    rewards: <RewardsPage {...pageProps} />,
    ranking: <RankingPage {...pageProps} />,
    profile: <ProfilePage {...pageProps} onLogout={handleLogout} onResetDemo={handleResetDemo} />,
    search: <SearchPage {...pageProps} />,
    boundary: <BoundaryPage {...pageProps} />
  };

  return (
    <div className="app-shell">
      <TopBar employee={data.employee} onSearch={() => navigate("search")} onProfile={() => navigate("profile")} />
      {notice ? <NoticeBar notice={notice} onClose={() => setNotice(null)} /> : null}
      <main className="page-content">{pages[route]}</main>
      <BottomNav route={route} navigate={navigate} caseUnreadCount={caseUnreadCount(data.cases, data.isSupplier)} onReceiptCapture={handleReceiptCapture} />
    </div>
  );
}

function LoadingView() {
  return (
    <main className="gate-screen">
    <img className="gate-brand-logo" src={brandAssetUrl(brandConfig.logo)} alt={brandConfig.name} />
      <LoaderCircle className="gate-spinner spin" size={22} />
      <h1>正在进入{brandConfig.shortName}</h1>
      <p>正在恢复员工身份和完成记录</p>
    </main>
  );
}

function WechatOnlyView() {
  return (
    <main className="gate-screen">
    <img className="gate-brand-logo" src={brandAssetUrl(brandConfig.logo)} alt={brandConfig.name} />
      <span className="gate-icon"><MessageCircleMore size={24} /></span>
      <h1>请在微信中打开</h1>
      <p>{brandConfig.shortName}通过微信公众号确认员工身份。</p>
      {import.meta.env.DEV ? <button className="primary-button" type="button" onClick={enableDemoMode}><Smartphone size={18} />进入本地预览</button> : null}
    </main>
  );
}

function LoggedOutView({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="gate-screen">
      <img className="gate-brand-logo" src={brandAssetUrl(brandConfig.logo)} alt={brandConfig.name} />
      <span className="gate-icon"><LogOut size={24} /></span>
      <h1>已退出登录</h1>
      <p>当前员工端会话已结束。退出学习端不会解除微信绑定；如需更换员工身份，请切换到对应的微信账号。</p>
      <button className="primary-button" type="button" onClick={onLogin}><RefreshCw size={18} />重新登录</button>
    </main>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="gate-screen">
      <span className="gate-logo error"><AlertCircle size={27} /></span>
      <h1>暂时无法进入</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}><RefreshCw size={18} />重新加载</button>
    </main>
  );
}

function BindingView({ auth, busy, notice, onBind }: { auth: AuthResult; busy: boolean; notice: Notice | null; onBind: (storeId: string, name: string, noticeVersion: string) => void }) {
  const [name, setName] = React.useState("");
  const [accepted, setAccepted] = React.useState(false);
  const [noticeOpen, setNoticeOpen] = React.useState(false);
  const [storeId, setStoreId] = React.useState(() => {
    if (auth.preselectedStoreId && auth.stores.some((store) => store.id === auth.preselectedStoreId)) {
      return auth.preselectedStoreId;
    }
    if (auth.directEntry) return "";
    const headquarters = auth.stores.find((store) => store.name === brandConfig.headquartersName && store.status !== "inactive");
    return headquarters?.id || "";
  });
  const [keyword, setKeyword] = React.useState("");
  const filteredStores = filterOrganizations(auth.stores, keyword);
  const exactMatch = exactOrganizationMatch(filteredStores, keyword);
  React.useEffect(() => {
    if (exactMatch && exactMatch.id !== storeId) setStoreId(exactMatch.id);
  }, [exactMatch?.id, storeId]);
  const brands = Array.from(new Map(auth.stores.map((store) => {
    const id = store.brandId || "default";
    return [id, {
      id,
      name: store.brandName || brandConfig.shortName,
      status: "active",
      sortOrder: 10
    } satisfies Brand];
  })).values());
  const organizationGroups = groupOrganizationsByBrand(filteredStores, brands);
  const directEntry = Boolean(auth.directEntry);
  const manualEntry = Boolean(auth.manualEntry || auth.identityProvider === "manual-review");
  return (
    <main className="binding-screen">
      <header className="binding-brand">
        <img src={brandAssetUrl(brandConfig.logo)} alt="" />
        <span><strong>{brandConfig.shortName}</strong><small>{brandConfig.employeeSubtitle}</small></span>
      </header>
      <section className="binding-panel">
        <span className="step-label">{directEntry ? "测试版登录" : "首次登录"}</span>
        <h1>确认员工身份</h1>
        <p>仅限{brandConfig.headquartersName}已录入名单的员工使用。请选择所属门店或部门，并输入后台登记的完整姓名。</p>
        {notice ? <NoticeBar notice={notice} onClose={() => undefined} /> : null}
        <label className="field-label">查找门店/部门<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入名称、店号或地址" /></label>
        <div className="store-options" role="radiogroup" aria-label="选择门店或部门">
          {organizationGroups.map((group) => (
            <section className="organization-group" key={group.brand.id}>
              <h2>{group.brand.name}</h2>
              {group.organizations.map((store) => (
                <button className={store.id === storeId ? "selected" : ""} role="radio" aria-checked={store.id === storeId} type="button" key={store.id} onClick={() => setStoreId(store.id)}>
                  <span className="organization-copy"><strong>{store.name}</strong><small>{store.storeNo ? `${store.storeNo} 号 · ` : ""}{organizationTypeLabel(store.organizationType)}</small></span><i />
                </button>
              ))}
            </section>
          ))}
          {filteredStores.length === 0 ? <p className="store-empty">没有找到门店</p> : null}
        </div>
        <label className="field-label">员工姓名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入后台登记的完整姓名" maxLength={30} /></label>
        <label className="consent-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读并同意<button type="button" onClick={() => setNoticeOpen(true)}>《个人信息告知》</button></span></label>
        <button className="primary-button full-button" type="button" disabled={busy || !storeId || !name.trim() || !accepted} onClick={() => onBind(storeId, name.trim(), auth.policy?.employeeNoticeVersion || "")}>
          {busy ? <LoaderCircle className="spin" size={18} /> : null}{busy ? "正在确认" : "进入系统"}
        </button>
      </section>
      {noticeOpen ? <PrivacyNotice contact={auth.policy?.privacyContact || `请联系${brandConfig.shortName}管理员`} usesWechat={!manualEntry} onClose={() => setNoticeOpen(false)} /> : null}
    </main>
  );
}

function PrivacyNotice({ contact, usesWechat, onClose }: { contact: string; usesWechat: boolean; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="个人信息告知">
      <section className="policy-modal">
        <h2>个人信息告知</h2>
        <p>{brandConfig.name}为确认内部员工身份，会处理你的{usesWechat ? "微信昵称、头像、微信身份标识、" : "测试设备会话标识、"}姓名和所属门店，仅用于与{brandConfig.headquartersName}预录入员工名单进行身份匹配、登录和内部学习记录管理。</p>
        <p>姓名和所属门店由{brandConfig.headquartersName}统一维护。你可以联系管理员查询、更正或申请删除相关信息。</p>
        <p><strong>联系方式：</strong>{contact}</p>
        <button className="primary-button full-button" type="button" onClick={onClose}>我已了解</button>
      </section>
    </div>
  );
}
