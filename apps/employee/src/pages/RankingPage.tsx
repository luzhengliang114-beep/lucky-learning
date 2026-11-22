import { useMemo, useState } from "react";
import { brandConfig } from "@open-training/shared";
import { CheckCircle2, ChevronRight, Clock3, Medal, Trophy, X } from "lucide-react";
import type { PageProps } from "../appTypes";
import { Avatar, EmptyState, PageHeader, SegmentedControl } from "../components";
import { employeeRank, rankingValue, sortProductTaskRanking, sortRanking, sortStoreProductRankingRows, sortSupplierProductRanking, sortSupplierProductTaskRanking, supplierProductRankingValue } from "../rankingCore.js";
import type { RankingMode } from "../rankingCore.js";
import type { ProductTaskRankingEmployee } from "../data";

type RankingViewMode = RankingMode | "product";
type ProductRankingView = "employees" | "stores";

function periodLabel(periodKey = "") {
  const [year, month] = periodKey.split("-");
  return year && month ? `${year} 年 ${Number(month)} 月` : periodKey;
}

function isProductTaskEmployee(employee: unknown): employee is ProductTaskRankingEmployee {
  return Boolean(employee && typeof employee === "object" && "attainmentRate" in employee);
}

export function RankingPage({ data, navigate }: PageProps) {
  const isSupplier = data.employee.role === "supplier" || data.isSupplier === true;
  const isAdmin = data.employee.role === "admin";
  const [mode, setMode] = useState<RankingViewMode>("completion");
  const [productRankingView, setProductRankingView] = useState<ProductRankingView>("employees");
  const [detailEmployeeId, setDetailEmployeeId] = useState("");
  const supplierProducts = isSupplier ? (data.employee.supplierProductKeys || []).map((item) => String(item).trim()).filter(Boolean) : [];
  const [supplierProduct, setSupplierProduct] = useState(supplierProducts[0] || "");
  const selectedSupplierProduct = supplierProducts.includes(supplierProduct) ? supplierProduct : supplierProducts[0] || "";
  const productRankings = data.productTaskRankings || [];
  const storeProductRankings = data.storeProductRankings || [];
  const productOptions = isSupplier
    ? supplierProducts
    : [...new Set([...productRankings.map((item) => item.productKey), ...storeProductRankings.map((item) => item.productKey)])];
  const [selectedProduct, setSelectedProduct] = useState(productOptions[0] || "");
  const selectedProductKey = isSupplier
    ? selectedSupplierProduct
    : productOptions.includes(selectedProduct) ? selectedProduct : productOptions[0] || "";
  const currentProductRanking = productRankings.find((item) => item.productKey === selectedProductKey);
  const currentStoreProductRanking = storeProductRankings.find((item) => item.productKey === selectedProductKey);
  const isProductMode = mode === "product";
  const isNotificationMode = mode === "notifications";
  const isStoreRankingMode = isProductMode && productRankingView === "stores";
  const standardMode: RankingMode = mode === "completion" ? "completion" : mode === "notifications" ? "notifications" : "beans";
  const ranking = useMemo(() => {
    if (isProductMode) return isSupplier
      ? sortSupplierProductTaskRanking(currentProductRanking?.rows || [])
      : sortProductTaskRanking(currentProductRanking?.rows || []);
    if (!isSupplier) return sortRanking(data.ranking, standardMode);
    if (!selectedSupplierProduct) return [];
    return sortSupplierProductRanking(data.ranking, selectedSupplierProduct, standardMode);
  }, [currentProductRanking, data.ranking, isProductMode, isSupplier, selectedSupplierProduct, standardMode]);
  const storeRanking = useMemo(() => sortStoreProductRankingRows(currentStoreProductRanking?.rows || []), [currentStoreProductRanking]);
  const myStoreRankingRow = storeRanking.find((row) => (
    (data.employee.storeId && row.storeId === data.employee.storeId)
    || (data.employee.store && row.storeName === data.employee.store)
  ));
  const myRank = isSupplier || isStoreRankingMode ? null : employeeRank(ranking, data.employee.id);
  const currentEmployee = ranking.find((item) => item.id === data.employee.id);
  const currentValue = isStoreRankingMode
    ? Number(myStoreRankingRow?.attainmentRate || 0)
    : isSupplier
    ? 0
    : isProductMode
      ? Number(isProductTaskEmployee(currentEmployee) ? currentEmployee.attainmentRate : 0)
      : rankingValue(currentEmployee || data.employee, standardMode);
  const isCompletionMode = mode === "completion";
  const detailEmployee = data.ranking.find((item) => item.id === detailEmployeeId) || null;
  const subtitle = isSupplier
    ? selectedSupplierProduct
      ? isStoreRankingMode
        ? `${brandConfig.shortName}启用门店 · 按${selectedSupplierProduct}门店销售达成率排名`
        : `${brandConfig.shortName}全体有效员工 · 按${selectedSupplierProduct}${isProductMode ? "销售任务达成率" : isCompletionMode ? "课程达成率" : "学习金豆"}排名`
      : "当前供应商账号暂未授权产品"
    : isStoreRankingMode
      ? currentStoreProductRanking
        ? `${periodLabel(currentStoreProductRanking.periodKey)} · 按${currentStoreProductRanking.productName}门店销售达成率排名`
        : "后台导入当前产品的门店销售数据后将在这里显示"
      : isProductMode
      ? currentProductRanking
        ? `${periodLabel(currentProductRanking.periodKey)} · 按${currentProductRanking.productName}任务达成率排名`
        : "当期产品任务导入后自动生成排行"
      : `${brandConfig.shortName}全体有效员工 · ${isNotificationMode ? "按任务接收率排名" : isCompletionMode ? "按课程达成率排名" : "按金豆余额排名"}`;

  return (
    <div>
      <PageHeader
        title="全员排行榜"
        subtitle={subtitle}
        onBack={() => navigate("home")}
      />
      <div className="ranking-mode-switch">
        {isSupplier ? <label className="supplier-product-picker"><span>产品</span><select value={selectedSupplierProduct} onChange={(event) => setSupplierProduct(event.target.value)}>{supplierProducts.map((product) => <option key={product} value={product}>{product}</option>)}</select></label> : null}
        <SegmentedControl value={mode} options={isSupplier
          ? [{ value: "beans", label: "产品积分" }, { value: "completion", label: "课程达成" }, { value: "product", label: "销售达成" }]
          : [{ value: "completion", label: "课程达成" }, { value: "notifications", label: "任务接收" }, { value: "beans", label: "金豆排名" }, { value: "product", label: "产品达成" }]} onChange={(value) => { setMode(value); setDetailEmployeeId(""); }} />
        {isProductMode ? (
          <SegmentedControl
            value={productRankingView}
            options={[{ value: "employees", label: "员工排行" }, { value: "stores", label: "门店排行" }]}
            onChange={setProductRankingView}
          />
        ) : null}
        {!isSupplier && isProductMode && productOptions.length ? (
          <div className="product-ranking-picker" role="tablist" aria-label="选择产品">
            {productOptions.map((productKey) => (
              <button
                aria-selected={productKey === selectedProductKey}
                className={productKey === selectedProductKey ? "active" : ""}
                key={productKey}
                onClick={() => setSelectedProduct(productKey)}
                role="tab"
                type="button"
              >
                {productRankings.find((item) => item.productKey === productKey)?.productName
                  || storeProductRankings.find((item) => item.productKey === productKey)?.productName
                  || productKey}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!isSupplier && isStoreRankingMode ? <section className="my-rank-band store-my-rank-band">
        <span><Trophy size={21} /></span>
        <div><small>{data.employee.store || myStoreRankingRow?.storeName || "我的门店"} · 我的门店排名</small><strong>{myStoreRankingRow ? `第 ${myStoreRankingRow.rank || storeRanking.indexOf(myStoreRankingRow) + 1} 名 / 共 ${storeRanking.length} 家` : "暂无门店销售数据"}</strong></div>
        <b>{myStoreRankingRow ? `${currentValue}%` : "未导入"}</b>
      </section> : !isSupplier && !isAdmin ? <section className="my-rank-band">
        <span><Trophy size={21} /></span>
        <div><small>我的当前排名</small><strong>{myRank ? `第 ${myRank} 名` : "暂无排名"}</strong></div>
        <b>{isNotificationMode
          ? data.employee.notificationAcknowledgementHasData ? `${data.employee.notificationAcknowledgedCount || 0}/${data.employee.notificationRequiredCount || 0} · ${currentValue}%` : "暂无任务"
          : isProductMode && !myRank ? "未导入" : isProductMode || isCompletionMode ? `${currentValue}%` : `${currentValue} 金豆`}</b>
      </section> : null}

      {isStoreRankingMode ? storeRanking.length ? (
        <div className="ranking-list">
          {storeRanking.map((store, index) => (
            <article className={`ranking-row store-ranking-row${store.storeId === data.employee.storeId || (data.employee.store && store.storeName === data.employee.store) ? " is-me" : ""}`} key={store.id || store.storeId}>
              <span className={`rank-number rank-${index + 1}`}>{index < 3 ? <Medal size={19} /> : store.rank || index + 1}</span>
              <div className="store-ranking-name"><strong>{store.storeName}{store.storeId === data.employee.storeId || (data.employee.store && store.storeName === data.employee.store) ? "（我的门店）" : ""}</strong><small>完成 {store.completedQuantity}/{store.targetQuantity}</small></div>
              <b>{Math.max(0, Math.min(100, Number(store.attainmentRate || 0)))}%</b>
            </article>
          ))}
        </div>
      ) : <EmptyState
        title="暂无门店销售数据"
        text="总部导入当前产品和统计周期的门店销售任务后，将在这里显示门店排名。"
        icon={<Trophy size={24} />}
      /> : ranking.length ? (
        <div className="ranking-list">
          {ranking.map((employee, index) => {
            const productEmployee = isProductTaskEmployee(employee) ? employee : null;
            return (
              <article
                className={`${employee.id === data.employee.id ? "ranking-row is-me" : "ranking-row"}${isAdmin && (isCompletionMode || isNotificationMode) ? " is-inspectable" : ""}`}
                key={employee.id}
                onClick={isAdmin && (isCompletionMode || isNotificationMode) ? () => setDetailEmployeeId(employee.id) : undefined}
                onKeyDown={isAdmin && (isCompletionMode || isNotificationMode) ? (event) => { if (event.key === "Enter" || event.key === " ") setDetailEmployeeId(employee.id); } : undefined}
                role={isAdmin && (isCompletionMode || isNotificationMode) ? "button" : undefined}
                tabIndex={isAdmin && (isCompletionMode || isNotificationMode) ? 0 : undefined}
              >
                <span className={`rank-number rank-${index + 1}`}>{index < 3 ? <Medal size={19} /> : index + 1}</span>
                <Avatar employee={employee} size="small" />
                <div>
                  <strong>{employee.name}{employee.id === data.employee.id ? "（我）" : ""}</strong>
                  <small>{employee.store || employee.employeeNo}{isNotificationMode
                    ? employee.notificationAcknowledgementHasData ? ` · 已接收 ${employee.notificationAcknowledgedCount || 0}/${employee.notificationRequiredCount || 0}` : " · 暂无接收任务"
                    : isProductMode && productEmployee ? productEmployee.hasTaskData === false ? " · 未导入任务" : ` · 完成 ${productEmployee.completedQuantity}/${productEmployee.targetQuantity}` : ""}</small>
                </div>
                <b>{isNotificationMode
                  ? employee.notificationAcknowledgementHasData ? `${Math.max(0, Math.min(100, Number(employee.notificationAcknowledgementRate || 0)))}%` : "暂无"
                  : isProductMode && productEmployee
                  ? productEmployee.hasTaskData === false ? "未导入" : `${Math.max(0, Math.min(100, Number(productEmployee.attainmentRate || 0)))}%`
                  : isSupplier
                    ? isCompletionMode
                      ? `${supplierProductRankingValue(employee, selectedSupplierProduct, "completion")}%`
                      : `${supplierProductRankingValue(employee, selectedSupplierProduct, "beans")} 金豆`
                    : isCompletionMode
                      ? `${rankingValue(employee, "completion")}%`
                      : `${rankingValue(employee, "beans")} 金豆`}</b>
                {isAdmin && (isCompletionMode || isNotificationMode) ? <ChevronRight className="ranking-detail-chevron" size={16} /> : null}
              </article>
            );
          })}
        </div>
      ) : <EmptyState
        title={isSupplier && !selectedSupplierProduct ? "暂未授权产品" : isSupplier ? isProductMode ? "暂无销售任务数据" : isCompletionMode ? "暂无课程达成数据" : "暂无产品积分" : isProductMode ? "暂无产品任务排行" : "暂无排行数据"}
        text={isSupplier && !selectedSupplierProduct ? "请联系总部管理员配置供应商授权产品" : isSupplier ? "当前授权产品暂时没有可展示的员工数据" : isProductMode ? "总部导入当期产品任务后将在这里显示" : "有效员工数据同步后将在这里显示"}
        icon={<Trophy size={24} />}
      />}
      {isAdmin && detailEmployee && (isCompletionMode || isNotificationMode) ? (
        <RankingDetail
          employee={detailEmployee}
          mode={isNotificationMode ? "notifications" : "completion"}
          onClose={() => setDetailEmployeeId("")}
        />
      ) : null}
    </div>
  );
}

function RankingDetail({ employee, mode, onClose }: { employee: PageProps["data"]["ranking"][number]; mode: "completion" | "notifications"; onClose: () => void }) {
  const isNotifications = mode === "notifications";
  const details = employee.productLearningDetails || [];
  const pending = employee.pendingNotifications || [];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${employee.name}${isNotifications ? "任务接收" : "课程达成"}明细`}>
      <section className="policy-modal ranking-detail-modal">
        <header><div><h2>{employee.name}</h2><p>{employee.store || employee.employeeNo} · {isNotifications ? "任务接收明细" : "课程达成明细"}</p></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>
        {isNotifications ? (
          <>
            <div className="ranking-detail-summary"><strong>{employee.notificationAcknowledgedCount || 0}/{employee.notificationRequiredCount || 0}</strong><span>已接收 · {employee.notificationAcknowledgementHasData ? `${employee.notificationAcknowledgementRate || 0}%` : "暂无任务"}</span></div>
            <div className="ranking-detail-list">
              {pending.length ? pending.map((item) => <article key={item.caseId}><span className="ranking-detail-status pending"><Clock3 size={17} /></span><div><strong>{item.title}</strong><small>{item.productName || "公司通知"} · 尚未点击接收</small></div></article>) : <div className="ranking-detail-empty"><CheckCircle2 size={24} /><strong>全部通知已接收</strong></div>}
            </div>
          </>
        ) : (
          <div className="ranking-detail-list product-progress-detail">
            {details.length ? details.map((item) => <article key={item.productKey}><div className="product-progress-heading"><strong>{item.productName}</strong><b>{item.completionRate}%</b></div><small>已完成 {item.completedUnitCount}/{item.unitCount} 项 · {item.completionRate >= 100 ? "已完成" : item.completionRate > 0 ? "学习中" : "未开始"}</small><div className="ranking-product-progress" aria-label={`${item.productName}完成${item.completionRate}%`}><span style={{ width: `${Math.max(0, Math.min(100, item.completionRate))}%` }} /></div></article>) : <div className="ranking-detail-empty"><Clock3 size={24} /><strong>暂无产品课程</strong></div>}
          </div>
        )}
        <button className="primary-button full-button" type="button" onClick={onClose}>关闭</button>
      </section>
    </div>
  );
}
