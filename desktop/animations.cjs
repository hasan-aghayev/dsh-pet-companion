(function installAnimations(root, factory) {
  const value = factory()
  if (typeof module === 'object' && module.exports) module.exports = value
  else root.lokkiAnimations = value
})(globalThis, function createAnimations() {
  const animations = Object.freeze({
    idle: { row: 0, frames: [0, 1, 2, 3, 4, 5, 6], ms: [280, 110, 110, 140, 140, 180, 320] },
    runningRight: { row: 1, frames: [0, 1, 2, 3, 4, 5, 6, 7], ms: [120, 120, 120, 120, 120, 120, 120, 180] },
    runningLeft: { row: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7], ms: [120, 120, 120, 120, 120, 120, 120, 180] },
    waving: { row: 3, frames: [0, 1, 2, 3], ms: [100, 300, 300, 120] },
    jumping: { row: 4, frames: [0, 1, 2, 3, 4], ms: [120, 120, 120, 120, 140] },
    failed: { row: 5, frames: [0, 1, 2, 3, 4, 5, 6, 7], ms: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { row: 6, frames: [0, 1, 2, 3, 4, 5], ms: [150, 150, 150, 150, 150, 150] },
    running: { row: 7, frames: [0, 1, 2, 3, 4, 5], ms: [120, 120, 120, 120, 120, 120] },
    review: { row: 8, frames: [0, 1, 2, 3, 4, 5], ms: [150, 150, 150, 150, 150, 150] },
  })

  function lookFrame(index) {
    const direction = Number.isInteger(index) ? ((index % 16) + 16) % 16 : 0
    return { row: 9 + Math.floor(direction / 8), column: direction % 8 }
  }

  return Object.freeze({ animations, lookFrame })
})
