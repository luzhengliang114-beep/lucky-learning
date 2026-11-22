export function isPptCourse(course: { resourceType?: string } | null | undefined): boolean;
export function isPptSlideDeckReady(course: { resourceType?: string; slideCount?: number; slideImagePrefix?: string; slideImageUrls?: string[] } | null | undefined): boolean;
export function courseResourceLabel(course: { resourceType?: string; slideCount?: number; slideImagePrefix?: string; slideImageUrls?: string[]; hasVideo?: boolean } | null | undefined): string;
