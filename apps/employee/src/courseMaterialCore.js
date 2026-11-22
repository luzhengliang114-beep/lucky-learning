export function isPptCourse(course) {
  return course?.resourceType === "ppt";
}

export function isPptSlideDeckReady(course) {
  return Boolean(
    isPptCourse(course)
    && Number(course?.slideCount || 0) > 0
    && (
      Array.isArray(course?.slideImageUrls) && course.slideImageUrls.length >= Number(course.slideCount)
      || typeof course?.slideImagePrefix === "string" && course.slideImagePrefix.trim()
    )
  );
}

export function courseResourceLabel(course) {
  if (isPptCourse(course)) {
    return isPptSlideDeckReady(course) ? `PPT · ${Number(course.slideCount || 0)}页` : "PPT页面待生成";
  }
  return course?.hasVideo ? "视频" : "资料";
}
