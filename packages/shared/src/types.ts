export type Status = "draft" | "published" | "pending" | "approved" | "rejected";
export type CourseTrack = "product" | "chronic";
export type ChronicCategory = "diabetes" | "hypertension" | "hyperuricemia" | "hyperlipidemia";

export interface Region {
  id: string;
  name: string;
  status?: "active" | "inactive";
}

export interface Brand {
  id: string;
  name: string;
  status: "active" | "inactive";
  sortOrder?: number;
}

export interface Store {
  id: string;
  name: string;
  regionId: string;
  brandId?: string;
  brandName?: string;
  storeNo?: string;
  address?: string;
  organizationType?: "store" | "department";
  status?: "active" | "inactive";
  sourceKey?: string;
}

export interface Employee {
  id: string;
  name: string;
  employeeNo: string;
  position?: string;
  role: "employee" | "storeManager" | "admin" | "supplier";
  storeId: string;
  regionId: string;
  goldenBeans: number;
  courseCompletionRate: number;
  examPassRate: number;
  status: "active" | "inactive";
  avatarUrl?: string;
  wechatAvatarUrl?: string;
  wechatNickname?: string;
  wechatBound?: boolean;
  wechatBindingCount?: number;
  recordingNoticeVersion?: string;
  recordingNoticeAcceptedAt?: string;
  /** 供应商账号显示名称。 */
  supplierName?: string;
  /** 供应商可查看的产品键；供应商权限不依赖备注文本。 */
  supplierProductKeys?: string[];
  /** 管理员查看的通知确认统计；普通员工只能看到汇总百分比。 */
  notificationAcknowledgedCount?: number;
  notificationRequiredCount?: number;
  notificationAcknowledgementRate?: number;
  notificationAcknowledgementHasData?: boolean;
  pendingNotifications?: Array<{
    caseId: string;
    title: string;
    productName?: string;
    createdAt: string;
  }>;
  productLearningDetails?: Array<{
    productKey: string;
    productName: string;
    completedUnitCount: number;
    unitCount: number;
    completionRate: number;
  }>;
}

export interface EmployeeApplication {
  id: string;
  employeeName: string;
  storeId: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  reviewRound?: number;
  resubmissionOf?: string;
  employeeId?: string;
  wechatNickname?: string;
  wechatAvatarUrl?: string;
  identityProvider?: "wechat-oauth" | "manual-review";
}

export interface CompliancePolicy {
  employeeNoticeVersion: string;
  recordingNoticeVersion: string;
  casePrivacyVersion: string;
  privacyContact: string;
}

export interface EmployeeRecording {
  id: string;
  phraseId: string;
  title: string;
  createdAt: string;
  fileId: string;
}

export interface Course {
  id: string;
  title: string;
  duration: string;
  description: string;
  goldenBeans: number;
  completionRate: number;
  status: "draft" | "published";
  track?: CourseTrack;
  productName?: string;
  productImage?: string;
  productImageUrl?: string;
  chronicCategory?: ChronicCategory;
  coverImage?: string;
  coverImageUrl?: string;
  videoUrl?: string;
  videoFileId?: string;
  resourceType?: "pdf" | "ppt" | "doc" | "video-link";
  resourceUrl?: string;
  resourceFileId?: string;
  resourceName?: string;
  resourceContentType?: string;
  slideCount?: number;
  slideImageFileIds?: string[];
  slideImageUrls?: string[];
  slideImagePrefix?: string;
  slideMinSeconds?: number;
  pptProcessingStatus?: "processing" | "ready" | "failed";
  pptConversionJobId?: string;
  sortOrder?: number;
}

export interface Phrase {
  id: string;
  title: string;
  script: string;
  productId?: string;
  productName?: string;
  audioFileId?: string;
  audioUrl?: string;
  audioName?: string;
  goldenBeans: number;
  maxRewardedAttempts?: number;
  submissions: number;
  status: "draft" | "published";
  sortOrder?: number;
}

export interface ProductRewardRule {
  id: string;
  productKey: string;
  productName: string;
  rewardCap: number;
  status: "active" | "inactive";
}

export interface Question {
  id: string;
  prompt: string;
  options: string[];
  type?: "single" | "multiple";
  answerIndex?: number;
  answerIndexes?: number[];
  explanation?: string;
}

export interface Exam {
  id: string;
  title: string;
  productName?: string;
  passScore: number;
  goldenBeans: number;
  attempts: number;
  passRate: number;
  status: "draft" | "published";
  sortOrder?: number;
  groupKey?: string;
  subExamIndex?: number;
  totalSubExams?: number;
  maxAttempts?: number;
  attemptCount?: number;
  attemptsRemaining?: number;
  learningResetRequired?: boolean;
  questions: Question[];
}

export interface Submission {
  id: string;
  type: "pop" | "phrase" | "case";
  title: string;
  employeeId: string;
  storeId: string;
  publisherName?: string;
  publisherRole?: "employee" | "admin";
  publisherStore?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  goldenBeans: number;
  content?: string;
  phraseId?: string;
  recordingFileId?: string;
  images?: Array<{
    fileId?: string;
    imageUrl?: string;
    url?: string;
    width?: number;
    height?: number;
    size?: number;
  }>;
  videoFileId?: string;
  videoUrl?: string;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoSize?: number;
  commentCount?: number;
  likeCount?: number;
  deletedAt?: string;
  rejectReason?: string;
  casePrivacyConfirmed?: boolean;
  casePrivacyVersion?: string;
  productName?: string;
  /** 案例允许查看的供应商员工 ID；空数组表示不开放给供应商。 */
  visibleSupplierIds?: string[];
  acknowledgementRequired?: boolean;
  acknowledgementStatus?: "pending" | "acknowledged" | "not-required";
  acknowledgedAt?: string;
  acknowledgementTargetCount?: number;
  acknowledgementAcknowledgedCount?: number;
  acknowledgementPendingCount?: number;
}

export interface CaseComment {
  id: string;
  caseId: string;
  employeeId: string;
  content: string;
  replyToCommentId?: string;
  replyToEmployeeId?: string;
  createdAt: string;
  deletedAt?: string;
}

export interface GoldenBeanLedgerEntry {
  id: string;
  employeeId: string;
  source: string;
  delta: number;
  reason: string;
  createdAt: string;
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  goldenBeanPrice: number;
  stock: number;
  status: "active" | "inactive";
  imageFileId?: string;
  imageUrl?: string;
  sortOrder?: number;
  nonDrugConfirmed?: boolean;
  nonDrugConfirmedAt?: string;
  nonDrugConfirmedBy?: string;
}

export interface Redemption {
  id: string;
  rewardId: string;
  employeeId: string;
  goldenBeanCost: number;
  status: "pending" | "fulfilled";
  createdAt: string;
  redemptionType?: "goldenBean" | "storeTaskReward";
  storeTaskRewardId?: string;
  rewardTitle?: string;
  rewardValue?: number;
  storeId?: string;
  storeName?: string;
  productKey?: string;
  periodKey?: string;
  claimNumber?: number;
  fulfilledAt?: string;
  fulfilledBy?: string;
  fulfillRemark?: string;
}
