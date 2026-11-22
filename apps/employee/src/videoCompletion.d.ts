export interface VideoCourseLike {
  videoUrl?: string | null;
}

export function playableVideoUrl(course: VideoCourseLike): string;
export function canCompleteVideoCourse(course: VideoCourseLike, watched: boolean): boolean;
