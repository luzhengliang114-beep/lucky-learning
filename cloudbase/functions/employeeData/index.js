const {
  db,
  fail,
  getFirst,
  ok
} = require("./_shared/db");
const { canViewCase, canViewProduct } = require("./_shared/supplierAccess");

function normalizeId(item = {}) {
  const { _id, ...rest } = item;
  return {
    ...rest,
    id: item.id || _id
  };
}

function publicEmployee(employee = {}) {
  const { inviteCode, ...safeEmployee } = employee;
  return safeEmployee;
}

function productKey(item = {}) {
  return String(item.productKey || item.productId || item.productName || item.title || "").trim();
}

function supplierCanViewProduct(employee = {}, item = {}) {
  if (employee.role !== "supplier") return true;
  const allowed = Array.isArray(employee.supplierProductKeys) ? employee.supplierProductKeys.map((value) => String(value || "").trim()).filter(Boolean) : [];
  return allowed.includes(productKey(item));
}

function supplierCanViewCase(employee = {}, item = {}) {
  if (employee.role !== "supplier") return true;
  const supplierId = String(employee._id || employee.id || "");
  return supplierCanViewProduct(employee, item)
    && Array.isArray(item.visibleSupplierIds)
    && item.visibleSupplierIds.map(String).includes(supplierId);
}

function publicQuestion(question = {}) {
  return {
    id: question.id || question._id,
    prompt: question.prompt || "",
    options: Array.isArray(question.options) ? question.options : [],
    type: question.type === "multiple" ? "multiple" : "single",
    sortOrder: Number(question.sortOrder || 999)
  };
}

async function getCollection(collectionName, limit = 100) {
  const result = await db.collection(collectionName).limit(limit).get();
  return (result.data || []).map(normalizeId);
}

async function getEmployeeContext(openId) {
  if (!openId) {
    return null;
  }

  const user = await getFirst("users", { openId, status: "active" });
  if (!user) {
    return null;
  }

  const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
  if (!employee) {
    return null;
  }

  const store = employee.storeId ? await getFirst("stores", { _id: employee.storeId }) : null;
  const region = employee.regionId ? await getFirst("regions", { _id: employee.regionId }) : null;

  return {
    user: normalizeId(user),
    employee: {
      ...publicEmployee(normalizeId(employee)),
      store: store?.name || "",
      region: region?.name || ""
    }
  };
}

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const employeeContext = await getEmployeeContext(openId);

    const [
      courses,
      phrases,
      exams,
      questions,
      rewards,
      employees,
      stores,
      popSubmissions,
      phraseSubmissions,
      cases,
      goldenBeanLedger,
      redemptions
    ] = await Promise.all([
      getCollection("courses"),
      getCollection("phrases"),
      getCollection("exams"),
      getCollection("questions", 1000),
      getCollection("rewards"),
      getCollection("employees"),
      getCollection("stores"),
      getCollection("popSubmissions"),
      getCollection("phraseSubmissions"),
      getCollection("cases"),
      getCollection("goldenBeanLedger"),
      getCollection("redemptions")
    ]);

    const employeeId = employeeContext?.employee.id;
    const submissions = employeeId
      ? [...popSubmissions, ...phraseSubmissions, ...cases]
          .map((item) => ({
            ...item,
            status: item.status || "pending",
            goldenBeans: Number(item.goldenBeans || 0)
          }))
          .filter((item) => item.employeeId === employeeId)
      : [];

    const myLedger = goldenBeanLedger.filter((item) => item.employeeId === employeeId);
    const myRedemptions = redemptions.filter((item) => item.employeeId === employeeId);
    const ranking = employees
      .filter((employee) => employee.role !== "supplier")
      .map((employee) => {
        const store = stores.find((item) => item.id === employee.storeId);
        return {
          ...publicEmployee(employee),
          store: store?.name || ""
        };
      })
      .sort((a, b) => Number(b.goldenBeans || 0) - Number(a.goldenBeans || 0));

    const publishedExams = exams
      .filter((item) => item.status === "published")
      .map((exam) => {
        const examQuestions = questions
          .filter((question) => question.examId === exam.id)
          .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999))
          .map(publicQuestion);

        return {
          ...exam,
          questionCount: examQuestions.length || exam.questionIds?.length || 0,
          questions: examQuestions
        };
      });

    return ok({
      bound: Boolean(employeeContext),
      employee: employeeContext?.employee || null,
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        regionId: store.regionId || ""
      })),
      courses: courses.filter((item) => item.status === "published" && canViewProduct(employeeContext?.employee || {}, item)),
      phrases: phrases.filter((item) => item.status === "published" && canViewProduct(employeeContext?.employee || {}, item)),
      exams: publishedExams.filter((item) => canViewProduct(employeeContext?.employee || {}, item)),
      rewards: rewards.filter((item) => item.status === "active"),
      submissions,
      cases: cases.filter((item) => canViewCase(employeeContext?.employee || {}, item)),
      ranking,
      goldenBeanLedger: myLedger,
      redemptions: myRedemptions
    });
  } catch (error) {
    return fail(error.message, "EMPLOYEE_DATA_FAILED");
  }
};
