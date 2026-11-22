import type { Reward } from "./types";

export const demoRewards: Reward[] = [
  {
    id: "demo-reward-learning-star",
    title: "学习之星礼盒",
    description: "月度学习激励测试礼品。",
    goldenBeanPrice: 9999,
    stock: 18,
    status: "active",
    imageUrl: "",
    sortOrder: 10,
    nonDrugConfirmed: true,
    nonDrugConfirmedAt: "2026-07-30T00:00:00.000Z",
    nonDrugConfirmedBy: "demo-seed"
  },
  {
    id: "demo-reward-afternoon-tea",
    title: "门店下午茶基金",
    description: "团队激励测试礼品，可由店长代领。",
    goldenBeanPrice: 9999,
    stock: 6,
    status: "active",
    imageUrl: "",
    sortOrder: 20,
    nonDrugConfirmed: true,
    nonDrugConfirmedAt: "2026-07-30T00:00:00.000Z",
    nonDrugConfirmedBy: "demo-seed"
  },
  {
    id: "demo-reward-cartoon-cat",
    title: "卡通猫咪礼品",
    description: "用于测试礼品图片上传与兑换卡片展示。",
    goldenBeanPrice: 9999,
    stock: 9,
    status: "active",
    imageUrl: "",
    sortOrder: 30,
    nonDrugConfirmed: true,
    nonDrugConfirmedAt: "2026-07-30T00:00:00.000Z",
    nonDrugConfirmedBy: "demo-seed"
  }
];
