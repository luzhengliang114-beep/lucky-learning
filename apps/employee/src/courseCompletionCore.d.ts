export function courseIdValue(course: unknown): string;

export function courseLearningCompleted(
  course: unknown,
  completedCourseIds?: ReadonlySet<string>
): boolean;
