import type { StoreProductSaleImportRow } from "./data";

export function storeProductSalesRecordsFromMatrix(matrix: unknown[][]): StoreProductSaleImportRow[];
export function parseStoreProductSalesCsv(text: string): StoreProductSaleImportRow[];
export function storeProductSalesImportTemplate(): string;
