import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const root = fileURLToPath(new URL("../apps/employee/dist/", import.meta.url));
const apiOrigin = String(process.env.EMPLOYEE_API_ORIGIN || "").replace(/\/+$/, "");
const port = Number(process.env.EMPLOYEE_PREVIEW_PORT || 4173);

if (!apiOrigin) {
  throw new Error("请通过 EMPLOYEE_API_ORIGIN 指定员工服务地址");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const relative = decoded.replace(/^\/+/, "");
  const resolved = normalize(join(root, relative));
  return resolved.startsWith(root) ? resolved : null;
}

async function proxyApi(req, res) {
  const headers = { "content-type": req.headers["content-type"] || "application/json" };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const response = await fetch(`${apiOrigin}/api/employee-web`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, {
    "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (requestUrl.pathname === "/api/employee-web") {
      await proxyApi(req, res);
      return;
    }

    const relativePath = requestUrl.pathname.replace(/^\/employee(?:\/|$)/, "");
    const candidate = safePath(relativePath || "index.html");
    const filePath = candidate && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=300"
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`预览服务异常：${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Employee H5 preview: http://127.0.0.1:${port}/employee/?entry=scan#/home`);
});
