const databaseName = "employee-h5-demo-media";
const storeName = "media";
const mediaPrefix = "demo-media:";

type StoredMedia = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
};

export type DemoMediaReference = {
  fileId: string;
  name: string;
  type: string;
  size: number;
  url: string;
};

const objectUrls = new Map<string, string>();

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前浏览器不支持本地媒体存储"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地媒体存储"));
  });
}

function requestResult<T>(request: IDBRequest<T>, message: string) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(message));
  });
}

export function isDemoMediaId(value?: string) {
  return Boolean(value?.startsWith(mediaPrefix));
}

export async function saveDemoMedia(files: Array<File | Blob>): Promise<DemoMediaReference[]> {
  if (!files.length) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const records = files.map((file) => {
      const id = crypto.randomUUID();
      const stored: StoredMedia = {
        id,
        blob: file,
        name: file instanceof File ? file.name : "recording.webm",
        type: file.type || "application/octet-stream",
        size: file.size
      };
      return { id, file, stored, request: store.put(stored) };
    });
    await Promise.all(records.map((item) => requestResult(item.request, "媒体保存失败，请检查浏览器存储空间")));
    return records.map(({ id, file, stored }) => {
      const url = URL.createObjectURL(file);
      objectUrls.set(id, url);
      return { fileId: `${mediaPrefix}${id}`, name: stored.name, type: stored.type, size: stored.size, url };
    });
  } finally {
    database.close();
  }
}

export async function demoMediaUrl(fileId?: string) {
  if (!isDemoMediaId(fileId)) return "";
  const id = String(fileId).slice(mediaPrefix.length);
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const database = await openDatabase();
  try {
    const stored = await requestResult<StoredMedia | undefined>(database.transaction(storeName).objectStore(storeName).get(id), "媒体读取失败");
    if (!stored?.blob) return "";
    const url = URL.createObjectURL(stored.blob);
    objectUrls.set(id, url);
    return url;
  } finally {
    database.close();
  }
}

export async function deleteDemoMedia(fileIds: string[]) {
  const ids = fileIds.filter(isDemoMediaId).map((value) => value.slice(mediaPrefix.length));
  if (!ids.length) return;
  const database = await openDatabase();
  try {
    const store = database.transaction(storeName, "readwrite").objectStore(storeName);
    await Promise.all(ids.map((id) => requestResult(store.delete(id), "媒体清理失败")));
    ids.forEach((id) => {
      const url = objectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(id);
    });
  } finally {
    database.close();
  }
}

export async function resetDemoMedia() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("本地媒体清理失败"));
    request.onblocked = () => resolve();
  });
}
