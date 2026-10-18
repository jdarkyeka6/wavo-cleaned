// WKWebView keyboard geometry, shared by every native chat screen.
// The visual viewport is the actual visible rectangle. Do not subtract a
// separately calculated keyboard height from it: iOS may already have resized.
export function measureViewportGeometry({
  visualHeight,
  innerHeight,
  visualOffsetTop = 0,
  previousFullHeight = 0,
  hasVisualViewport = true,
}) {
  const layoutHeight = Math.max(1, Math.round(Number(innerHeight) || 0))
  const visibleHeight = Math.max(1, Math.round(Number(visualHeight) || layoutHeight))
  const offsetTop = Math.max(0, Math.round(Number(visualOffsetTop) || 0))
  const fullHeight = Math.max(layoutHeight, visibleHeight + offsetTop)
  const baseline = previousFullHeight > 0 ? previousFullHeight : fullHeight
  const visualShrunk = hasVisualViewport && baseline - visibleHeight > 120
  const layoutShrunk = baseline - layoutHeight > 120
  const keyboardOpen = visualShrunk || layoutShrunk

  // With visualViewport, its reported rectangle owns chat geometry, whether
  // or not WKWebView also shrinks innerHeight. Never shrink that size twice.
  const visibleTop = visualShrunk ? offsetTop : 0
  const viewportHeight = visualShrunk
    ? visibleHeight
    : layoutShrunk
      ? layoutHeight
      : fullHeight

  return {
    viewportHeight,
    visibleTop,
    keyboardOpen,
    keyboardHeight: keyboardOpen
      ? Math.max(0, baseline - viewportHeight - visibleTop)
      : 0,
    fullHeight: keyboardOpen ? baseline : fullHeight,
  }
}
