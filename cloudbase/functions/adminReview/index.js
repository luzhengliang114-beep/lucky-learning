const { createServer } = require("node:http");
const {
  addGoldenBeansOnce,
  db,
  fail,
  getFirst,
  now,
  ok
} = require("./_shared/db");
const { assertAdminSecret, bearerSecret } = require("./authCore");

const collectionByType = {
  pop: "popSubmissions",
  phrase: "phraseSubmissions",
  case: "cases"
};

const reviewSecret = process.env.ADMIN_REVIEW_SECRET || "";

function sendJson(req, res, body, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Accept, Authorization",
    vary: "Origin"
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function reviewSubmission(payload) {
  const secret = requireString(payload.secret, "secret");
  const submissionType = requireString(payload.submissionType, "submissionType");
  const submissionId = requireString(payload.submissionId, "submissionId");
  const decision = requireString(payload.decision, "decision");
  const rejectReason = typeof payload.rejectReason === "string" ? payload.rejectReason : "";

  if (secret !== reviewSecret) {
    return fail("Review code is invalid", "INVALID_REVIEW_SECRET");
  }
  if (!["approved", "rejected"].includes(decision)) {
    return fail("Decision must be approved or rejected", "INVALID_DECISION");
  }

  const collectionName = collectionByType[submissionType];
  if (!collectionName) {
    return fail("Unsupported submission type", "INVALID_SUBMISSION_TYPE");
  }

  const submission = await getFirst(collectionName, { _id: submissionId });
  if (!submission) {
    return fail("Submission not found", "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== "pending") {
    return ok({
      alreadyReviewed: true,
      submissionId,
      status: submission.status,
      award: null
    });
  }

  await db.collection(collectionName).doc(submissionId).update({
    status: decision,
    rejectReason: decision === "rejected" ? rejectReason : "",
    reviewedBy: "web-admin",
    reviewedAt: now()
  });

  const award = decision === "approved"
    ? await addGoldenBeansOnce({
        employeeId: submission.employeeId,
        sourceType: submissionType,
        sourceId: submissionId,
        delta: Number(submission.goldenBeans || 0),
        reason: `审核通过：${submission.title}`,
        createdBy: "web-admin"
      })
    : null;

  return ok({
    alreadyReviewed: false,
    submissionId,
    status: decision,
    award
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(req, res, {}, 204);
    return;
  }

  if (req.method !== "POST") {
    sendJson(req, res, fail("Only POST requests are supported", "METHOD_NOT_ALLOWED"), 405);
    return;
  }

  try {
    const providedSecret = bearerSecret(req.headers.authorization);
    assertAdminSecret({ configuredSecret: reviewSecret, providedSecret });
    const payload = await readJson(req);
    payload.secret = providedSecret;
    const result = await reviewSubmission(payload);
    sendJson(req, res, result, result.ok ? 200 : 400);
  } catch (error) {
    const statusCode = error.code === "ADMIN_UNAUTHORIZED" ? 401 : error.code === "ADMIN_SECRET_REQUIRED" ? 503 : 500;
    sendJson(req, res, fail(error.message, error.code || "ADMIN_REVIEW_FAILED"), statusCode);
  }
});

server.listen(9000, "0.0.0.0", () => {
  console.log("adminReview HTTP function listening on port 9000");
});
