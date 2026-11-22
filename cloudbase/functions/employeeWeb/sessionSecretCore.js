const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const DEFAULT_COLLECTION = "webRuntimeConfigs";
const DEFAULT_DOC_ID = "employeeWebSessionSecret";

function normalizeSecret(value) {
  return String(value || "").trim();
}

function isMissingCollectionError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "DATABASE_COLLECTION_NOT_EXIST" || /Db or Table not exist|collection not exist|table not exist/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "DATABASE_COLLECTION_ALREADY_EXIST" || /Table exist|collection already exists?|table already exists?/i.test(message);
}

function createSessionSecretManager({
  db,
  envSecret = "",
  now = () => new Date().toISOString(),
  sessionTtlMs = 7 * 24 * 60 * 60 * 1000,
  collectionName = DEFAULT_COLLECTION,
  docId = DEFAULT_DOC_ID,
  randomBytesImpl = randomBytes
} = {}) {
  const configuredSecret = normalizeSecret(envSecret);
  let cachedSecret = "";
  let pendingSecretPromise = null;

  async function ensureCollectionExists(collection) {
    if (typeof db?.createCollection !== "function") return;
    try {
      await db.createCollection(collection);
    } catch (error) {
      if (!isCollectionAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  async function loadPersistedSecret() {
    if (!db?.runTransaction) {
      const error = new Error("无法初始化 H5 会话密钥，请检查数据库权限或配置 WEB_SESSION_SECRET");
      error.code = "WEB_SESSION_SECRET_UNAVAILABLE";
      throw error;
    }

    const readOrCreateSecret = async () => db.runTransaction(async (transaction) => {
      const doc = transaction.collection(collectionName).doc(docId);
      const current = await doc.get();
      const existing = current.data?.[0];
      const existingSecret = normalizeSecret(existing?.secret);
      if (existingSecret) {
        return existingSecret;
      }

      const generatedSecret = randomBytesImpl(32).toString("base64url");
      const timestamp = now();
      await doc.set({
        secret: generatedSecret,
        source: "generated-fallback",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      return generatedSecret;
    });

    try {
      return await readOrCreateSecret();
    } catch (error) {
      if (!isMissingCollectionError(error)) {
        throw error;
      }
      await ensureCollectionExists(collectionName);
      return readOrCreateSecret();
    }
  }

  async function getSessionSecret() {
    if (configuredSecret) {
      return configuredSecret;
    }
    if (cachedSecret) {
      return cachedSecret;
    }
    if (!pendingSecretPromise) {
      pendingSecretPromise = loadPersistedSecret()
        .then((secret) => {
          cachedSecret = normalizeSecret(secret);
          if (!cachedSecret) {
            const error = new Error("无法初始化 H5 会话密钥，请检查数据库权限或配置 WEB_SESSION_SECRET");
            error.code = "WEB_SESSION_SECRET_UNAVAILABLE";
            throw error;
          }
          return cachedSecret;
        })
        .finally(() => {
          pendingSecretPromise = null;
        });
    }
    return pendingSecretPromise;
  }

  async function signState(redirectUri) {
    const secret = await getSessionSecret();
    const issuedAt = String(Date.now());
    const payload = `${issuedAt}.${Buffer.from(String(redirectUri || "")).toString("base64url")}`;
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  async function verifyState(state, redirectUri) {
    const secret = await getSessionSecret();
    const parts = String(state || "").split(".");
    if (parts.length !== 3) return false;
    const [issuedAt, encodedRedirect, signature] = parts;
    const payload = `${issuedAt}.${encodedRedirect}`;
    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) return false;
    return Buffer.from(encodedRedirect, "base64url").toString() === String(redirectUri || "");
  }

  async function createSession(openId, employeeId = "", wechatProfile = {}) {
    await getSessionSecret();
    const token = randomBytesImpl(32).toString("base64url");
    const createdAt = now();
    const createdAtMs = Date.parse(createdAt);
    const expiresAt = new Date((Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) + sessionTtlMs).toISOString();
    const sessionRecord = {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      openId,
      ...(employeeId ? { employeeId } : {}),
      ...(wechatProfile.avatarUrl ? { wechatAvatarUrl: wechatProfile.avatarUrl } : {}),
      ...(wechatProfile.nickname ? { wechatNickname: wechatProfile.nickname } : {}),
      status: "active",
      createdAt,
      expiresAt
    };
    try {
      await db.collection("webSessions").add(sessionRecord);
    } catch (error) {
      if (!isMissingCollectionError(error)) {
        throw error;
      }
      await ensureCollectionExists("webSessions");
      await db.collection("webSessions").add(sessionRecord);
    }
    return { token, expiresAt };
  }

  function resetCache() {
    cachedSecret = "";
    pendingSecretPromise = null;
  }

  return {
    createSession,
    getSessionSecret,
    resetCache,
    signState,
    verifyState
  };
}

module.exports = {
  createSessionSecretManager,
  isCollectionAlreadyExistsError,
  normalizeSecret
};
