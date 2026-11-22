export interface BrandConfig {
  name: string;
  shortName: string;
  employeeSubtitle: string;
  adminSubtitle: string;
  privacyContact: string;
  headquartersName: string;
  defaultOrganizationId: string;
  logo: string;
  favicon: string;
  loginBackground: string;
  colors: {
    primary: string;
    accent: string;
    progress: string;
    surface: string;
    text: string;
  };
  features: {
    speaking: boolean;
    rewards: boolean;
    ranking: boolean;
  };
}

export function validateBrandConfig(input: unknown): string[];
export function normalizeBrandConfig(input: unknown): BrandConfig;
export function joinBrandAssetUrl(baseUrl: string, assetPath: string): string;
