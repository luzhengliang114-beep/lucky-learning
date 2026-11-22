const { createServer } = require("node:http");
const cloudbase = require("@cloudbase/node-sdk");
const { db, fail, getFirst, now, ok } = require("./_shared/db");
const { buildLearningTodos } = require("./_shared/learningTodos");
const { dateKey, logKey, shouldNotify, summaryHash, summaryText } = require("./_shared/employeeReminderCore");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const oaAppId = process.env.WECHAT_OA_APPID || "";
const oaAppSecret = process.env.WECHAT_OA_APP_SECRET || "";
const templateId = process.env.WECHAT_NOTIFICATION_TEMPLATE_ID || "";
const messageUrl = process.env.WECHAT_NOTIFICATION_URL || "";
const runSecret = process.env.REMINDER_RUN_SECRET || "";

function isMissingCollectionError(error) {
  const message = String(error?.message || "");
  return /collection not exist|table not exist|not found/i.test(message) || String(error?.code || "") === "DATABASE_COLLECTION_NOT_EXIST";
}

async function getCollection(name, limit = 1000) {
  try {
    const result = await db.collection(name).limit(limit).get();
    return result.data || [];
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    if (!/already exists|exist/i.test(String(error?.message || ""))) throw error;
  }
}

async function accessToken() {
  if (!oaAppId || !oaAppSecret) throw new Error("WECHAT_OA_APPID 或 WECHAT_OA_APP_SECRET 未配置");
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", oaAppId);
  url.searchParams.set("secret", oaAppSecret);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.errmsg || "获取服务号 access_token 失败");
  return body.access_token;
}

async function sendTemplateMessage(token, openId, textValue, count) {
  if (!templateId) throw new Error("WECHAT_NOTIFICATION_TEMPLATE_ID 未配置");
  const url = new URL("https://api.weixin.qq.com/cgi-bin/message/template/send");
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      touser: openId,
      template_id: templateId,
      url: messageUrl,
      data: {
        first: { value: "学习待办提醒" },
        keyword1: { value: `${count} 项未完成` },
        keyword2: { value: textValue.slice(0, 180) },
        remark: { value: "完成后下一次提醒会自动更新。" }
      }
    })
  });
  const body = await response.json();
  if (!response.ok || Number(body.errcode || 0) !== 0) {
    const error = new Error(body.errmsg || "微信通知发送失败");
    error.code = String(body.errcode || "WECHAT_MESSAGE_FAILED");
    throw error;
  }
  return body;
}

async function runReminderJob() {
  const day = dateKey();
  const [employees, users, courses, phrases, exams, phraseAttempts, ledger, examAttempts, courseProgress, employeeProductTasks] = await Promise.all([
    getCollection("employees"),
    getCollection("users"),
    getCollection("courses"),
    getCollection("phrases"),
    getCollection("exams"),
    getCollection("phrasePracticeAttempts"),
    getCollection("goldenBeanLedger"),
    getCollection("examAttempts"),
    getCollection("courseProgress"),
    getCollection("employeeProductTasks")
  ]);
  await ensureCollection("employeeNotificationLogs");
  const userByEmployee = new Map(users.filter((user) => user.status === "active" && user.employeeId).map((user) => [String(user.employeeId), user]));
  const staff = employees.filter((employee) => employee.status === "active" && employee.role !== "supplier");
  const summary = { day, employees: staff.length, candidates: 0, sent: 0, skipped: 0, failed: 0, logs: [] };
  let token = null;

  for (const employee of staff) {
    const employeeId = String(employee._id || employee.id || "");
    const user = userByEmployee.get(employeeId) || {};
    const todos = buildLearningTodos({
      employeeId,
      courses,
      courseProgress,
      phrases,
      phrasePracticeAttempts: phraseAttempts,
      goldenBeanLedger: ledger,
      exams,
      examAttempts,
      employeeProductTasks,
      productTaskPeriodKey: day.slice(0, 7),
      supplier: false
    });
    if (!todos.count) {
      summary.skipped += 1;
      continue;
    }
    summary.candidates += 1;
    const hash = summaryHash(todos.todos);
    const key = logKey({ employeeId, day, hash });
    const existing = await getFirst("employeeNotificationLogs", { key });
    if (existing?.status === "sent") {
      summary.skipped += 1;
      continue;
    }
    const message = summaryText(todos.todos);
    let status = "not-authorized";
    let errorCode = "";
    if (shouldNotify({ employee, user, todos: todos.todos })) {
      try {
        token ||= await accessToken();
        await sendTemplateMessage(token, user.openId, message, todos.count);
        status = "sent";
        summary.sent += 1;
      } catch (error) {
        status = "failed";
        errorCode = String(error.code || "WECHAT_MESSAGE_FAILED");
        summary.failed += 1;
        token = null;
      }
    } else {
      summary.skipped += 1;
    }
    await db.collection("employeeNotificationLogs").add({ key, employeeId, dayKey: day, summaryHash: hash, count: todos.count, status, errorCode, createdAt: now() });
    summary.logs.push({ employeeId, status, count: todos.count, errorCode });
  }
  return ok(summary);
}

async function handle(event = {}) {
  if (event.action === "run") {
    if (!runSecret || event.secret !== runSecret) return fail("提醒任务调用凭证无效", "REMINDER_AUTH_REQUIRED");
  }
  return runReminderJob();
}

const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ ok: true, service: "employeeReminder" }));
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify(fail("Only POST requests are supported", "METHOD_NOT_ALLOWED"))); }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
      const result = await handle(body ? JSON.parse(body) : {});
      res.statusCode = result.ok ? 200 : 400;
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error("[employeeReminder-error]", { code: error.code || "EMPLOYEE_REMINDER_FAILED", message: error.message });
      res.statusCode = 500;
      res.end(JSON.stringify(fail(error.message, error.code || "EMPLOYEE_REMINDER_FAILED")));
    }
  });
});

exports.main = handle;
if (require.main === module) server.listen(9001, "0.0.0.0", () => console.log("employeeReminder HTTP function listening on port 9001"));
