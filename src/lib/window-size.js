// Layout decisions follow usable window width, never a device identifier.
export const EXPANDED_NATIVE_WIDTH = 700
export const WINDOW_GEOMETRY_RESET_THRESHOLD = 56

export function getNativeWindowClass(width, isNative) {
  return isNative && Number.isFinite(width) && width >= EXPANDED_NATIVE_WIDTH
    ? 'expanded'
    : 'compact'
}

export function shouldResetViewportHeight(previousWidth, nextWidth) {
  return previousWidth > 0 &&
    Number.isFinite(previousWidth) &&
    Number.isFinite(nextWidth) &&
    Math.abs(nextWidth - previousWidth) > WINDOW_GEOMETRY_RESET_THRESHOLD
}
