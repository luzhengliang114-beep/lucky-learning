import type { Employee } from "@open-training/shared";
import type { StoreProductRankingRow } from "./data";

export type RankingMode = "beans" | "completion" | "notifications";
export type RankingEmployee = Employee & { store?: string; productCompletionRates?: Record<string, number>; productGoldenBeans?: Record<string, number> };
export type ProductTaskRankingEmployee = RankingEmployee & { hasTaskData?: boolean; targetQuantity: number; completedQuantity: number; attainmentRate: number };

export function normalizeRankingValue(value: unknown, mode: RankingMode): number;
export function rankingValue(employee: Partial<RankingEmployee> | null | undefined, mode: RankingMode): number;
export function sortRanking(ranking: RankingEmployee[] | null | undefined, mode: RankingMode): RankingEmployee[];
export function employeeRank(ranking: Array<Pick<RankingEmployee, "id">> | null | undefined, employeeId: string): number | null;
export function sortProductTaskRanking(ranking: ProductTaskRankingEmployee[] | null | undefined): ProductTaskRankingEmployee[];
export function sortStoreProductRankingRows(ranking: StoreProductRankingRow[] | null | undefined): StoreProductRankingRow[];
export function supplierProductRankingValue(employee: Partial<RankingEmployee> | null | undefined, productKey: string, mode: RankingMode): number;
export function sortSupplierProductRanking(ranking: RankingEmployee[] | null | undefined, productKey: string, mode: RankingMode): RankingEmployee[];
export function sortSupplierProductTaskRanking(ranking: ProductTaskRankingEmployee[] | null | undefined): ProductTaskRankingEmployee[];
