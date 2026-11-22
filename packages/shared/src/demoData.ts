import brandsSeed from "../../../cloudbase/database/seed/brands.json";
import regionsSeed from "../../../cloudbase/database/seed/regions.json";
import storesSeed from "../../../cloudbase/database/seed/stores.json";
import { brandAssetUrl, brandConfig } from "./brandConfig";

import type {
  Brand, Course, Employee, Exam, GoldenBeanLedgerEntry, Phrase,
  Redemption, Region, Reward, Store, Submission
} from "./types";

export const brands = brandsSeed.map(({ _id, ...brand }) => ({ ...brand, id: _id, name: brandConfig.name })) as Brand[];
export const regions = regionsSeed.map(({ _id, ...region }) => ({ ...region, id: _id })) as Region[];
export const stores = storesSeed.map(({ _id, ...store }) => ({ ...store, id: _id, brandName: brandConfig.name })) as Store[];

const demoStore = stores[0];
const demoProduct = "示例产品A";

export const employees: Employee[] = [{
  id: "demo-employee",
  name: "预览员工",
  employeeNo: "DEMO-001",
  role: "employee",
  storeId: demoStore.id,
  regionId: demoStore.regionId,
  goldenBeans: 0,
  courseCompletionRate: 0,
  examPassRate: 0,
  status: "active"
}];

export const courses: Course[] = [
  {
    id: "demo-video-001",
    title: "示例产品A入门视频",
    duration: "12 秒",
    description: "认识包装上的产品编号、规格和批次。",
    goldenBeans: 3,
    completionRate: 0,
    status: "published",
    track: "product",
    productName: demoProduct,
    videoUrl: brandAssetUrl("demo/training.mp4"),
    sortOrder: 10
  },
  {
    id: "demo-ppt-001",
    title: "示例产品A陈列指南",
    duration: "6 秒",
    description: "核对产品编号与陈列标签，发现差异时记录并反馈。",
    goldenBeans: 0,
    completionRate: 0,
    status: "published",
    track: "product",
    productName: demoProduct,
    resourceType: "ppt",
    resourceName: "示例陈列指南.pptx",
    slideCount: 2,
    slideImagePrefix: brandAssetUrl("demo/page-"),
    slideMinSeconds: 3,
    sortOrder: 20
  }
];

export const phrases: Phrase[] = [{
  id: "demo-phrase-001",
  productName: demoProduct,
  title: "核对包装信息",
  script: "请核对外包装上的产品编号和规格，如果标签不一致，请交给值班负责人核实。",
  goldenBeans: 2,
  maxRewardedAttempts: 2,
  submissions: 0,
  status: "published",
  sortOrder: 10
}];

export const exams: Exam[] = [{
  id: "demo-exam-001",
  title: "示例产品A陈列测评",
  productName: demoProduct,
  passScore: 80,
  goldenBeans: 6,
  attempts: 0,
  passRate: 0,
  status: "published",
  sortOrder: 10,
  questions: [
    { id: "demo-question-001", prompt: "摆放前应核对哪些信息？", options: ["产品编号与规格", "包装颜色", "货架高度", "标签字体"], type: "single", answerIndex: 0 },
    { id: "demo-question-002", prompt: "标签与包装不一致时该怎么做？", options: ["直接上架", "记录差异并反馈", "遮住原标签", "跳过核对"], type: "single", answerIndex: 1 }
  ]
}];

export const submissions: Submission[] = [];
export const goldenBeanLedger: GoldenBeanLedgerEntry[] = [];
export const rewards: Reward[] = [];
export const redemptions: Redemption[] = [];

export const dashboardStats = {
  totalEmployees: 0,
  averageCompletion: 0,
  examPassRate: 0,
  pendingReviews: 0,
  pendingEmployeeApplications: 0,
  issuedGoldenBeans: 0
};
