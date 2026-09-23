function acquireSingleInstanceLock(app, onAcquired = () => {}) {
  const acquired = app.requestSingleInstanceLock()
  if (!acquired) {
    app.exit(0)
    return false
  }
  onAcquired()
  return true
}

module.exports = { acquireSingleInstanceLock }
