export function playableVideoUrl(course) {
  const url = typeof course?.videoUrl === "string" ? course.videoUrl.trim() : "";
  return url && !url.startsWith("cloud://") ? url : "";
}

export function canCompleteVideoCourse(course, watched) {
  return Boolean(playableVideoUrl(course) && watched);
}
