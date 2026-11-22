import type {
  Course,
  Employee,
  Exam,
  GoldenBeanLedgerEntry,
  Phrase
} from "@open-training/shared";
import type {
  CourseProgressRecord,
  EmployeeWechatBindingSummary,
  ExamAttemptRecord,
  PhrasePracticeAttemptRecord,
  EmployeeProductTask,
  SupplierEmployeeMetric,
  SupplierProductView,
  SupplierView
} from "./data";

type EmployeeRecord = Employee & EmployeeWechatBindingSummary;

function clamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + clamp(value), 0) / values.length) : 0;
}

function idOf(item: { id?: string; _id?: string }) {
  return String(item.id || item._id || "");
}

function productOf(item: { productName?: string; productKey?: string; productId?: string; title?: string }) {
  return String(item.productKey || item.productId || item.productName || item.title || "").trim();
}

function courseRate(course: Course, progress?: CourseProgressRecord) {
  if (progress?.completed || progress?.videoWatchCompleted || progress?.readingCompleted) return 100;
  const explicit = Number(progress?.progress);
  if (Number.isFinite(explicit)) return clamp(explicit);
  const slideCount = Number(course.slideCount || 0);
  if (course.resourceType === "ppt" && slideCount > 0) return clamp(Number(progress?.unlockedSlides || 0) / slideCount * 100);
  const duration = Number(progress?.videoDurationSeconds || (course as Course & { videoDurationSeconds?: number }).videoDurationSeconds || 0);
  const watched = Number(progress?.maxWatchedSeconds || 0);
  return duration > 0 ? clamp(watched / duration * 100) : 0;
}

function phraseCount(phrase: Phrase, employeeId: string, attempts: PhrasePracticeAttemptRecord[], ledger: GoldenBeanLedgerEntry[]) {
  const phraseId = idOf(phrase);
  const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
  const passed = attempts.filter((item) => String(item.employeeId) === employeeId && String(item.phraseId) === phraseId && item.passed !== false && item.counted !== false).length;
  const legacy = ledger.filter((item) => {
    const sourceId = String((item as GoldenBeanLedgerEntry & { sourceId?: string }).sourceId || "");
    return String(item.employeeId) === employeeId && Number(item.delta || 0) > 0 && (sourceId === phraseId || sourceId.startsWith(`${phraseId}-`));
  }).length;
  return Math.min(limit, Math.max(passed, legacy));
}

function taskCompleted(employeeId: string, item: Course | Phrase | Exam, tasks: EmployeeProductTask[]) {
  const productKey = productOf(item);
  return Boolean(productKey && tasks.some((task) => (
    String(task.employeeId) === employeeId
    && String(task.productKey || "").trim() === productKey
    && Number(task.targetQuantity || 0) > 0
    && Number(task.completedQuantity || 0) >= Number(task.targetQuantity || 0)
  )));
}

function metricsForEmployee(employee: EmployeeRecord, courses: Course[], phrases: Phrase[], exams: Exam[], progress: CourseProgressRecord[], phraseAttempts: PhrasePracticeAttemptRecord[], ledger: GoldenBeanLedgerEntry[], examAttempts: ExamAttemptRecord[], employeeProductTasks: EmployeeProductTask[]) {
  const employeeId = idOf(employee);
  const courseValues = courses.filter((item) => item.status === "published").map((course) => taskCompleted(employeeId, course, employeeProductTasks) ? 100 : courseRate(course, progress.find((item) => String(item.employeeId) === employeeId && String(item.courseId) === idOf(course))));
  const phraseValues = phrases.filter((item) => item.status === "published").flatMap((phrase) => {
    const limit = Math.max(1, Math.trunc(Number(phrase.maxRewardedAttempts || 1)));
    if (taskCompleted(employeeId, phrase, employeeProductTasks)) return Array.from({ length: limit }, () => 100);
    const completed = phraseCount(phrase, employeeId, phraseAttempts, ledger);
    return Array.from({ length: limit }, (_, index) => index < completed ? 100 : 0);
  });
  const examValues = exams.filter((item) => item.status === "published").map((exam) => taskCompleted(employeeId, exam, employeeProductTasks) || examAttempts.some((attempt) => String(attempt.employeeId) === employeeId && String(attempt.examId) === idOf(exam) && attempt.passed !== false && Number(attempt.score || 0) >= 90) ? 100 : 0);
  return {
    completionRate: average([...courseValues, ...phraseValues, ...examValues]),
    contentCompletionRate: average([...courseValues, ...phraseValues]),
    examPassRate: average(examValues)
  };
}

export function buildSupplierViews({ employees, stores, courses, phrases, exams, courseProgress, phrasePracticeAttempts, goldenBeanLedger, examAttempts, employeeProductTasks }: {
  employees: EmployeeRecord[];
  stores: Array<{ id: string; _id?: string; name: string; organizationType?: "store" | "department"; status?: string }>;
  courses: Course[];
  phrases: Phrase[];
  exams: Exam[];
  courseProgress: CourseProgressRecord[];
  phrasePracticeAttempts: PhrasePracticeAttemptRecord[];
  goldenBeanLedger: GoldenBeanLedgerEntry[];
  examAttempts: ExamAttemptRecord[];
  employeeProductTasks: EmployeeProductTask[];
}): SupplierView[] {
  const storeName = (storeId: string) => stores.find((store) => String(store.id || store._id) === String(storeId))?.name || "";
  const staff = employees.filter((employee) => {
    if (employee.status !== "active" || employee.role === "supplier" || employee.role === "admin") return false;
    const store = stores.find((item) => String(item.id || item._id) === String(employee.storeId || ""));
    return Boolean(store && store.organizationType !== "department" && store.status !== "inactive");
  });
  return employees.filter((employee) => employee.status === "active" && employee.role === "supplier").map((supplier) => {
    const productKeys = (supplier.supplierProductKeys || []).map((item) => String(item).trim()).filter(Boolean);
    const products = productKeys.map((productKey) => {
      const productCourses = courses.filter((item) => productOf(item) === productKey);
      const productPhrases = phrases.filter((item) => productOf(item) === productKey);
      const productExams = exams.filter((item) => productOf(item) === productKey);
      const employeeMetrics = staff.map((employee) => {
        const metrics = metricsForEmployee(employee, productCourses, productPhrases, productExams, courseProgress, phrasePracticeAttempts, goldenBeanLedger, examAttempts, employeeProductTasks);
        return {
          ...employee,
          store: storeName(employee.storeId),
          completionRate: metrics.completionRate,
          contentCompletionRate: metrics.contentCompletionRate,
          examPassRate: metrics.examPassRate
        } satisfies SupplierEmployeeMetric;
      });
      return {
        productKey,
        productName: productKey,
        averageCompletionRate: average(employeeMetrics.map((item) => item.completionRate)),
        employees: employeeMetrics
      } satisfies SupplierProductView;
    });
    return {
      supplierId: idOf(supplier),
      supplierName: supplier.name,
      supplierLabel: supplier.supplierName || "未填写厂家",
      wechatBound: supplier.wechatBound,
      wechatNickname: supplier.wechatNickname,
      productKeys,
      products
    } satisfies SupplierView;
  });
}
