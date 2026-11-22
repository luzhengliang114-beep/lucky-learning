export function filterOrganizations(organizations: any[], keyword: string): any[];
export function exactOrganizationMatch(organizations: any[], keyword: string): any | null;
export function groupOrganizationsByBrand(organizations: any[], brands: any[]): Array<{ brand: any; organizations: any[] }>;
export function organizationDisplayName(organization: any): string;
export function organizationTypeLabel(type?: string): string;
