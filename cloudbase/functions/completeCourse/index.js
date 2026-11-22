const {
  addCappedGoldenBeans,
  db,
  fail,
  getFirst,
  now,
  ok,
  requireString
} = require("./_shared/db");

const productRewardCap = 50;

exports.main = async (event = {}, context = {}) => {
  try {
    const openId = context.OPENID || event.openId;
    const courseId = requireString(event.courseId, "courseId");

    if (!openId) {
      return fail("Missing WeChat openId", "NO_OPENID");
    }

    const user = await getFirst("users", { openId, status: "active" });
    if (!user) {
      return fail("User is not bound to an employee", "USER_NOT_BOUND");
    }

    const course = await getFirst("courses", { _id: courseId, status: "published" });
    if (!course) {
      return fail("Course not found or unpublished", "COURSE_NOT_FOUND");
    }

    const existingProgress = await getFirst("courseProgress", {
      employeeId: user.employeeId,
      courseId
    });

    const hasVideo = Boolean(String(course.videoUrl || course.videoFileId || "").trim());
    if (!hasVideo) {
      return fail("该课程暂未上传视频，完成视频学习后才能获得金豆", "COURSE_VIDEO_REQUIRED");
    }
    if (event.watchCompleted !== true) {
      return fail("请先播放完视频再领取金豆", "COURSE_VIDEO_NOT_FINISHED");
    }

    if (existingProgress) {
      await db.collection("courseProgress").doc(existingProgress._id).update({
        progress: 100,
        completed: true,
        updatedAt: now()
      });
    } else {
      await db.collection("courseProgress").add({
        employeeId: user.employeeId,
        courseId,
        progress: 100,
        completed: true,
        createdAt: now(),
        updatedAt: now()
      });
    }

    const award = await addCappedGoldenBeans({
      employeeId: user.employeeId,
      sourceType: "course",
      sourceId: courseId,
      productKey: String(course.productId || course.productName || course._id || courseId),
      delta: Number(course.goldenBeans || 0),
      reason: `完成课程：${course.title}`,
      productCap: productRewardCap
    });

    return ok({
      courseId,
      award
    });
  } catch (error) {
    return fail(error.message, "COMPLETE_COURSE_FAILED");
  }
};
