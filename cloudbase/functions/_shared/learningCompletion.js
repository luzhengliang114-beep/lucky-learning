function learningProgressComplete(progress = {}) {
  return progress.completed === true
    || progress.videoWatchCompleted === true
    || progress.readingCompleted === true
    || Number(progress.progress || 0) >= 100;
}

module.exports = { learningProgressComplete };
