const {
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");

const collectionByType = {
  pop: "popSubmissions",
  phrase: "phraseSubmissions",
  case: "cases"
};

const defaultGoldenBeans = {
  pop: 50,
  phrase: 20,
  case: 80
};

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const type = requireString(event.type, "type");
    const title = requireString(event.title, "title");
    const collectionName = collectionByType[type];

    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }
    if (!collectionName) {
      return fail("Unsupported content type", "INVALID_CONTENT_TYPE");
    }

    const user = await getFirst("users", { openId, status: "active" });
    if (!user) {
      return fail("User is not bound to an employee", "USER_NOT_BOUND");
    }

    const employee = await getFirst("employees", { _id: user.employeeId, status: "active" });
    if (!employee) {
      return fail("Employee not found", "EMPLOYEE_NOT_FOUND");
    }

    const submission = {
      type,
      title,
      employeeId: employee._id,
      storeId: employee.storeId,
      regionId: employee.regionId,
      status: "pending",
      goldenBeans: Number(event.goldenBeans || defaultGoldenBeans[type] || 0),
      fileId: optionalString(event.fileId),
      content: optionalString(event.content),
      phraseId: optionalString(event.phraseId),
      createdAt: now()
    };

    if (type === "phrase" && !submission.phraseId) {
      return fail("phraseId is required", "PHRASE_ID_REQUIRED");
    }
    if (type === "pop" && !submission.fileId) {
      return fail("fileId is required", "FILE_ID_REQUIRED");
    }
    if (type === "case" && !submission.content) {
      return fail("content is required", "CONTENT_REQUIRED");
    }

    const result = await db.collection(collectionName).add(submission);

    return ok({
      submissionId: result.id,
      submission: {
        id: result.id,
        ...submission
      }
    });
  } catch (error) {
    return fail(error.message, "SUBMIT_CONTENT_FAILED");
  }
};
