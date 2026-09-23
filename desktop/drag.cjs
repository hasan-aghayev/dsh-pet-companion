function getDragPosition(origin, pointer, scaleFactor, workArea) {
  const values = [origin?.bounds?.x, origin?.bounds?.y, origin?.bounds?.width, origin?.bounds?.height,
    origin?.pointer?.x, origin?.pointer?.y, pointer?.x, pointer?.y, scaleFactor,
    workArea?.x, workArea?.y, workArea?.width, workArea?.height]
  if (!values.every(Number.isFinite) || scaleFactor <= 0) return null

  const { bounds } = origin
  const minX = workArea.x
  const minY = workArea.y
  const maxX = Math.max(minX, workArea.x + workArea.width - bounds.width)
  const maxY = Math.max(minY, workArea.y + workArea.height - bounds.height)
  const x = bounds.x + (pointer.x - origin.pointer.x) * scaleFactor
  const y = bounds.y + (pointer.y - origin.pointer.y) * scaleFactor
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, x))),
    y: Math.round(Math.min(maxY, Math.max(minY, y))),
  }
}

module.exports = { getDragPosition }
