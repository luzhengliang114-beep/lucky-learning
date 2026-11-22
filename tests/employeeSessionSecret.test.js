const test = require("node:test");
const assert = require("node:assert/strict");

const { createSessionSecretManager } = require("../cloudbase/functions/employeeWeb/sessionSecretCore");

function createFakeDb(initialSecret = "", options = {}) {
  const state = {
    secret: initialSecret,
    runTransactionCalls: 0,
    sessionRecords: [],
    createCollectionCalls: 0
  };
  let missingCollectionThrown = false;
  let missingSessionCollectionThrown = false;

  const doc = {
    get: async () => ({
      data: state.secret ? [{ secret: state.secret }] : []
    }),
    set: async (payload) => {
      state.secret = payload.secret;
      state.savedPayload = payload;
      return { ok: 1 };
    }
  };

  return {
    state,
    db: {
      createCollection: async (name) => {
        state.createCollectionCalls += 1;
        state.createdCollectionName = name;
        if (options.throwAlreadyExistsOnCreate) {
          const error = new Error("[ResourceUnavailable.ResourceExist] Table exist.");
          error.code = "DATABASE_COLLECTION_ALREADY_EXIST";
          throw error;
        }
        return { ok: 1 };
      },
      runTransaction: async (callback) => {
        state.runTransactionCalls += 1;
        if (options.throwMissingCollectionOnce && !missingCollectionThrown) {
          missingCollectionThrown = true;
          const error = new Error(`Db or Table not exist: ${options.missingCollectionName || "webRuntimeConfigs"}`);
          error.code = "DATABASE_COLLECTION_NOT_EXIST";
          throw error;
        }
        return callback({
          collection: () => ({
            doc: () => doc
          })
        });
      },
      collection: (name) => {
        if (name !== "webSessions") throw new Error(`unexpected collection: ${name}`);
        return {
          add: async (record) => {
            if (options.throwMissingWebSessionsOnce && !missingSessionCollectionThrown) {
              missingSessionCollectionThrown = true;
              const error = new Error("Db or Table not exist: webSessions");
              error.code = "DATABASE_COLLECTION_NOT_EXIST";
              throw error;
            }
            state.sessionRecords.push(record);
            return { id: `session-${state.sessionRecords.length}` };
          }
        };
      }
    }
  };
}

test("session secret manager falls back to persisted db secret when env secret is missing", async () => {
  const { db, state } = createFakeDb();
  const secretBytes = Buffer.alloc(32, 7);
  const manager = createSessionSecretManager({
    db,
    envSecret: "",
    now: () => "2026-07-29T10:00:00.000Z",
    sessionTtlMs: 1000,
    randomBytesImpl: () => secretBytes
  });

  const secret1 = await manager.getSessionSecret();
  const secret2 = await manager.getSessionSecret();
  assert.equal(secret1, secretBytes.toString("base64url"));
  assert.equal(secret2, secret1);
  assert.equal(state.runTransactionCalls, 1);
  assert.equal(state.secret, secret1);

  const stateToken = await manager.signState("https://example.com/employee/");
  assert.equal(await manager.verifyState(stateToken, "https://example.com/employee/"), true);
  assert.equal(await manager.verifyState(stateToken, "https://example.com/other/"), false);

  const session = await manager.createSession("openid-1", "employee-1", { nickname: "小明", avatarUrl: "https://avatar.example" });
  assert.match(session.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(state.sessionRecords.length, 1);
  assert.equal(state.sessionRecords[0].openId, "openid-1");
  assert.equal(state.sessionRecords[0].employeeId, "employee-1");
  assert.equal(state.sessionRecords[0].wechatNickname, "小明");
  assert.equal(state.sessionRecords[0].wechatAvatarUrl, "https://avatar.example");
});

test("session secret manager prefers configured env secret without touching db", async () => {
  const { db, state } = createFakeDb();
  const manager = createSessionSecretManager({
    db,
    envSecret: "fixed-secret",
    now: () => "2026-07-29T10:00:00.000Z",
    sessionTtlMs: 1000,
    randomBytesImpl: () => Buffer.alloc(32, 9)
  });

  assert.equal(await manager.getSessionSecret(), "fixed-secret");
  const signedState = await manager.signState("https://example.com/employee/");
  assert.equal(await manager.verifyState(signedState, "https://example.com/employee/"), true);
  assert.equal(state.runTransactionCalls, 0);
});

test("session secret manager auto-creates the fallback collection when it is missing", async () => {
  const { db, state } = createFakeDb("", { throwMissingCollectionOnce: true });
  const manager = createSessionSecretManager({
    db,
    envSecret: "",
    now: () => "2026-07-29T10:00:00.000Z",
    sessionTtlMs: 1000,
    randomBytesImpl: () => Buffer.alloc(32, 5)
  });

  const secret = await manager.getSessionSecret();
  assert.equal(secret, Buffer.alloc(32, 5).toString("base64url"));
  assert.equal(state.createCollectionCalls, 1);
  assert.equal(state.createdCollectionName, "webRuntimeConfigs");
  assert.equal(state.runTransactionCalls, 2);
});

test("session secret manager auto-creates webSessions when session storage is missing", async () => {
  const { db, state } = createFakeDb("persisted-secret", { throwMissingWebSessionsOnce: true });
  const manager = createSessionSecretManager({
    db,
    envSecret: "",
    now: () => "2026-07-29T10:00:00.000Z",
    sessionTtlMs: 1000,
    randomBytesImpl: () => Buffer.alloc(32, 4)
  });

  const session = await manager.createSession("openid-2", "employee-2");
  assert.equal(state.createCollectionCalls, 1);
  assert.equal(state.createdCollectionName, "webSessions");
  assert.equal(state.sessionRecords.length, 1);
  assert.equal(state.sessionRecords[0].openId, "openid-2");
  assert.equal(state.sessionRecords[0].employeeId, "employee-2");
  assert.equal(session.expiresAt, "2026-07-29T10:00:01.000Z");
});

test("session initialization tolerates a concurrent collection create", async () => {
  const { db, state } = createFakeDb("persisted-secret", {
    throwMissingWebSessionsOnce: true,
    throwAlreadyExistsOnCreate: true
  });
  const manager = createSessionSecretManager({
    db,
    envSecret: "",
    now: () => "2026-07-29T10:00:00.000Z",
    sessionTtlMs: 1000,
    randomBytesImpl: () => Buffer.alloc(32, 3)
  });

  const session = await manager.createSession("openid-concurrent", "employee-concurrent");
  assert.equal(state.createCollectionCalls, 1);
  assert.equal(state.sessionRecords.length, 1);
  assert.equal(session.expiresAt, "2026-07-29T10:00:01.000Z");
});
