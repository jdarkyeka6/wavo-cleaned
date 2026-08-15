// Geometry for the avatar cropper.
//
// Pure functions, kept out of the component so they can be tested without a
// DOM. The whole crop is described by two numbers — a zoom multiplier over the
// "cover" scale, and the image's top-left offset relative to the frame — and
// everything here reads or writes exactly those.

/**
 * The scale at which the shorter side of the image exactly fills the square
 * frame. Zoom 1 means "as much of the photo as can be shown without a gap".
 */
export function coverScale(imgW, imgH, frame) {
  if (!imgW || !imgH || !frame) return 1;
  return frame / Math.min(imgW, imgH);
}

/**
 * Pull an offset back into the range that keeps the frame fully covered.
 *
 * Offsets are the image's top-left relative to the frame, so they run from
 * (frame − scaled size) up to 0. Math.min(0, …) on the lower bound matters:
 * when a side is exactly covered the range collapses to the single point 0
 * rather than inverting, and an inverted range is what lets the image drift off
 * and expose a corner.
 */
export function clampOffset(offset, imgW, imgH, frame, zoom) {
  const s = coverScale(imgW, imgH, frame) * zoom;
  const minX = Math.min(0, frame - imgW * s);
  const minY = Math.min(0, frame - imgH * s);
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}

/**
 * Change zoom while keeping the frame's centre pinned, so whatever you are
 * looking at stays put instead of sliding away as you zoom in. Returns the new
 * zoom and the offset that preserves the centre, already clamped.
 */
export function zoomAbout(zoom, offset, next, imgW, imgH, frame, maxZoom) {
  const z = Math.min(maxZoom, Math.max(1, next));
  const k = z / zoom;
  const centred = {
    x: frame / 2 - (frame / 2 - offset.x) * k,
    y: frame / 2 - (frame / 2 - offset.y) * k,
  };
  return { zoom: z, offset: clampOffset(centred, imgW, imgH, frame, z) };
}

/**
 * The square of the source image the frame is currently showing, in source
 * pixels. This is what both the preview and the saved file are drawn from.
 */
export function cropRect(offset, imgW, imgH, frame, zoom) {
  const s = coverScale(imgW, imgH, frame) * zoom;
  return { sx: -offset.x / s, sy: -offset.y / s, side: frame / s };
}

/** Offset that centres the image in the frame at a given zoom. */
export function centreOffset(imgW, imgH, frame, zoom) {
  const s = coverScale(imgW, imgH, frame) * zoom;
  return { x: (frame - imgW * s) / 2, y: (frame - imgH * s) / 2 };
}
