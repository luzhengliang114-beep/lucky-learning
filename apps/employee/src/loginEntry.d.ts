export type LoginEntryMode = "oauth" | "direct";

export interface LoginEntry {
  mode: LoginEntryMode;
  storeId: string;
}

export function resolveLoginEntry(search: string): LoginEntry;
