import React from "react";
import { Gift, Headphones, PackageCheck, Sparkles, Upload } from "lucide-react";
import { isDemoMode, redeemReward, redeemStoreTaskReward, submitStoreReceipt } from "../data";
import type { PageProps } from "../appTypes";
import { BeanBadge, EmptyState, PageHeader, StatusPill } from "../components";

export function RewardsPage({ data, session, busy, navigate, runAction, notify, clearNotice, refresh, receiptCaptureFiles, onReceiptCaptureHandled }: PageProps) {
  const [confirmId, setConfirmId] = React.useState("");
  const [receiptBusy, setReceiptBusy] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const processedCaptureFilesRef = React.useRef<File[] | null>(null);
  const [receiptMessage, setReceiptMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [receiptResult, setReceiptResult] = React.useState<{ productName: string; quantity: number } | null>(null);

  async function uploadReceipt(fileList: FileList | File[] | null | undefined, productName: string) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length || receiptBusy) return;
    if (!session && !isDemoMode()) return;
    setReceiptBusy(true);
    setReceiptResult(null);
    clearNotice();
    try {
      if (isDemoMode() && !session) {
        const { saveDemoMedia } = await import("../demoMedia");
        await saveDemoMedia(files);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setReceiptResult({ productName, quantity: files.length });
        setReceiptMessage({ type: "success", text: `本地演示识别完成：${files.length} 张小票，共 ${files.length} 盒（未调用云端）` });
        return;
      }
      const results = await Promise.all(files.map(async (file) => {
        try {
          const result = await submitStoreReceipt(session!, file);
          return { ok: true as const, result };
        } catch (error) {
          return { ok: false as const, message: error instanceof Error ? error.message : "小票识别失败，请重新上传清晰图片" };
        }
      }));
      const successResults = results.filter((result) => result.ok);
      const failures = results.filter((result) => !result.ok);
      const successCount = successResults.length;
      const failureCount = failures.length;
      const recognizedQuantity = successResults.reduce((sum, result) => sum + Number(result.result.data?.receipt?.quantity || 0), 0);
      if (successCount) {
        await refresh({ fresh: true }).catch(() => undefined);
        const latest = successResults[successResults.length - 1]?.result.data?.receipt;
        if (latest?.productName || latest?.productKey) {
          setReceiptResult({ productName: latest.productName || latest.productKey, quantity: recognizedQuantity || Number(latest.quantity || 0) });
        }
      }
      if (failureCount) {
        const reasons = failures.map((result) => result.message).filter(Boolean);
        const reasonText = reasons.length ? `：${reasons.join("；")}` : "";
        const message = `${files.length} 张小票已处理：${successCount} 张识别成功，${failureCount} 张识别不通过${reasonText}`;
        setReceiptMessage({ type: "error", text: message });
        notify({ type: "error", text: message });
      } else {
        const message = files.length > 1 ? `${files.length} 张小票已识别成功` : "小票已识别成功";
        setReceiptMessage({ type: "success", text: message });
        notify({ type: "success", text: message });
      }
    } finally {
      setReceiptBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  React.useEffect(() => {
    if (!receiptCaptureFiles?.length || processedCaptureFilesRef.current === receiptCaptureFiles) return;
    processedCaptureFilesRef.current = receiptCaptureFiles;
    const reward = data.storeTaskRewards[0];
    const productName = reward?.productKey || reward?.title || "销售小票";
    void uploadReceipt(receiptCaptureFiles, productName).finally(() => onReceiptCaptureHandled?.());
  }, [receiptCaptureFiles]);

  async function redeem(rewardId: string) {
    if (!session && data.source !== "fallback") return;
    const reward = data.rewards.find((item) => item.id === rewardId);
    if (!reward) return;
    await runAction(rewardId, () => redeemReward(session!, rewardId), {
      demoAction: { type: "redeemReward", payload: { rewardId } }
    });
    setConfirmId("");
  }

  async function redeemStoreTask(storeTaskRewardId: string) {
    if (!session && data.source !== "fallback") return;
    const reward = data.storeTaskRewards.find((item) => item.id === storeTaskRewardId);
    if (!reward) return;
    await runAction(`store-task:${storeTaskRewardId}`, () => redeemStoreTaskReward(session!, storeTaskRewardId), {
      demoAction: { type: "redeemStoreTaskReward", payload: { storeTaskRewardId } }
    });
    setConfirmId("");
  }

  return (
    <div>
      <PageHeader title="金豆好礼" subtitle="学习积累，兑换门店专属奖励" onBack={() => navigate("home")} action={<BeanBadge value={data.employee.goldenBeans} />} />
      <section className="reward-balance-band">
        <div><Sparkles size={22} /><span><small>当前可用金豆</small><strong>{data.employee.goldenBeans}</strong></span></div>
        <button type="button" onClick={() => document.getElementById("redemption-records")?.scrollIntoView({ behavior: "smooth" })}>兑换记录</button>
      </section>

      {data.storeTaskRewards.length ? <section className="store-task-reward-section">
        <div className="section-title"><div><h2>门店任务领取</h2><p>完成门店销售任务获得共享额度，不增加或扣减员工金豆</p></div></div>
        <div className="store-task-reward-grid">
          {data.storeTaskRewards.map((reward) => {
            const confirmKey = `store-task:${reward.id}`;
            const ready = reward.eligible && reward.availableCount > 0;
            return <article className="store-task-reward-card" key={reward.id}>
              <div className="store-task-reward-layout">
                <div className="store-task-reward-info">
                  <div className="store-task-reward-icon"><Gift size={25} /><span>门店任务</span></div>
                  <div className="store-task-reward-copy">
                    <h3>{reward.title}</h3>
                    <p>{reward.description}</p>
                    <strong>商品价值 ¥{reward.itemValue}</strong>
                    <small>{reward.storeName || "尚未匹配所属门店"} · {reward.periodKey} · 已完成 {reward.completedQuantity}/{reward.threshold} 盒</small>
                    <small>{reward.eligible ? `本店本期已领取 ${reward.claimedCount} 次 · 目前可领取 ${reward.availableCount} 次` : "当前账号尚未匹配可用门店，暂不能领取"}</small>
                  </div>
                </div>
                <div className="store-task-reward-side">
                  <div className="store-task-reward-actions">
                    <button className="secondary-button" type="button" disabled={receiptBusy || (!session && !isDemoMode())} onClick={() => uploadInputRef.current?.click()}>{receiptBusy ? "识别中" : <><Upload size={15} />上传小票</>}</button>
                    <input className="receipt-file-input" ref={uploadInputRef} type="file" accept="image/*" multiple aria-label="上传多张销售小票" onChange={(event) => uploadReceipt(event.target.files, reward.productKey || reward.title)} />
                    {receiptMessage ? <small className={`receipt-message receipt-message-${receiptMessage.type}`} role="status">{receiptMessage.text}</small> : null}
                    {receiptResult ? <small className="receipt-result" role="status">识别结果：{receiptResult.productName} × {receiptResult.quantity} 盒</small> : null}
                  </div>
                  {confirmId === confirmKey ? <div className="store-task-reward-confirm">
                    <span>确认使用本店 1 次额度领取？</span>
                    <button type="button" onClick={() => setConfirmId("")}>取消</button>
                    <button className="confirm" type="button" disabled={busy === confirmKey} onClick={() => redeemStoreTask(reward.id)}>{busy === confirmKey ? "提交中" : "确认领取"}</button>
                  </div> : <button className="secondary-button full-button" type="button" disabled={!ready || busy === confirmKey} onClick={() => setConfirmId(confirmKey)}>{!reward.eligible ? "暂不可领取" : ready ? "领取兑换品" : `完成${reward.threshold}盒后可领取`}</button>}
                </div>
              </div>
            </article>;
          })}
        </div>
      </section> : null}

      <div className="reward-grid">
        {data.rewards.map((reward, index) => {
          const affordable = data.employee.goldenBeans >= reward.goldenBeanPrice;
          const soldOut = reward.stock <= 0;
          return (
            <article className="reward-item" key={reward.id}>
              <div className={`reward-visual reward-visual-${index % 3}`}>
                {reward.imageUrl ? <img src={reward.imageUrl} alt="" /> : index % 2 ? <Headphones size={39} /> : <Gift size={39} />}
                <span>余 {reward.stock}</span>
              </div>
              <div className="reward-copy"><h2>{reward.title}</h2><p>{reward.description}</p><strong><Sparkles size={14} />{reward.goldenBeanPrice}</strong></div>
              {confirmId === reward.id ? (
                <div className="reward-confirm"><span>确认兑换？</span><button type="button" onClick={() => setConfirmId("")}>取消</button><button className="confirm" type="button" disabled={busy === reward.id} onClick={() => redeem(reward.id)}>确认</button></div>
              ) : <button className="secondary-button full-button" type="button" disabled={!affordable || soldOut} onClick={() => setConfirmId(reward.id)}>{soldOut ? "已兑完" : affordable ? "立即兑换" : "金豆不足"}</button>}
            </article>
          );
        })}
      </div>

      <section className="record-section" id="redemption-records">
        <div className="section-title"><div><h2>兑换记录</h2><p>后台处理后会更新发放状态</p></div></div>
        {data.redemptions.length ? <div className="record-list">{data.redemptions.map((record) => {
          const reward = data.rewards.find((item) => item.id === record.rewardId);
          const isStoreTaskReward = record.redemptionType === "storeTaskReward";
          return <article key={record.id}><span className="record-icon"><PackageCheck size={19} /></span><div><strong>{isStoreTaskReward ? record.rewardTitle || "门店任务兑换品" : reward?.title || "兑换奖励"}</strong><small>{formatDate(record.createdAt)} · {isStoreTaskReward ? `${record.storeName || "门店"} · 商品价值 ¥${record.rewardValue || 0} · 不扣金豆` : `${record.goldenBeanCost} 金豆`}</small></div><StatusPill status={record.status} /></article>;
        })}</div> : <EmptyState title="还没有兑换记录" text="完成学习任务积累金豆后即可兑换" />}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
