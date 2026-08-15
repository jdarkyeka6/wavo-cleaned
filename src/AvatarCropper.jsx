import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import {
  clampOffset,
  zoomAbout,
  cropRect,
  centreOffset,
} from "./lib/cropGeometry";

/**
 * Pick the part of the photo that becomes the avatar.
 *
 * Before this the whole image was squashed into a circle, so anything that
 * wasn't already square came out with the subject off-centre — which is most
 * photos, since phones shoot 4:3.
 *
 * Two things keep this honest:
 *
 *   The preview is a canvas drawn by the same function that writes the file,
 *   at a different size. A preview built out of CSS transforms would be a
 *   second implementation of the crop, free to disagree with the real one.
 *
 *   Rotation is applied to the bitmap itself rather than carried as an angle
 *   through the maths. Every other calculation here is then rotation-free,
 *   instead of every source rectangle needing to know which way is up.
 */

// The circle is drawn at 96px at most; 512 leaves room for retina and still
// encodes to a few tens of KB.
const OUT_PX = 512;
const MAX_ZOOM = 4;

/** Paint the chosen square of `img` into a size×size context. */
function drawCrop(ctx, img, sx, sy, side, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
}

/** A copy of `img` turned a quarter turn clockwise. */
async function rotateBitmap(img) {
  const c = document.createElement("canvas");
  c.width = img.height;
  c.height = img.width;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return createImageBitmap(c);
}

export default function AvatarCropper({ file, onCancel, onSave }) {
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const dragRef = useRef(null);
  // A pointermove handler fires far more often than React re-renders, so it
  // reads live values here rather than through a closure that may be a frame old.
  const live = useRef({ zoom: 1, offset: { x: 0, y: 0 }, img: null });
  live.current = { zoom, offset, img };

  const frameSize = () => frameRef.current?.clientWidth || 260;

  // --- load -----------------------------------------------------------

  useEffect(() => {
    if (!file) return;
    let dead = false;
    setError(null);
    setImg(null);
    // imageOrientation honours the EXIF rotation flag; without it a photo taken
    // in portrait arrives on its side and the user has to fix it by hand.
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bm) => {
        if (dead) return bm.close?.();
        setImg(bm);
        setZoom(1);
        // Open on the middle of the photo. {x:0,y:0} would be the image's
        // top-left corner pinned to the frame's, so a landscape shot would open
        // showing its far-left edge rather than whatever is in the middle.
        setOffset(centreOffset(bm.width, bm.height, frameSize(), 1));
      })
      .catch(() => !dead && setError("That image couldn't be opened."));
    return () => {
      dead = true;
    };
  }, [file]);

  // A decoded phone photo is tens of MB; holding onto several gets the tab killed.
  useEffect(() => () => live.current.img?.close?.(), []);

  // --- geometry -------------------------------------------------------
  // The maths lives in lib/cropGeometry so it can be tested without a DOM.

  const clamp = useCallback((o, z = zoom, i = img) => {
    if (!i) return o;
    return clampOffset(o, i.width, i.height, frameSize(), z);
  }, [zoom, img]);

  const applyZoom = useCallback((next) => {
    const { zoom: z0, offset: o0, img: i } = live.current;
    if (!i) return;
    const r = zoomAbout(z0, o0, next, i.width, i.height, frameSize(), MAX_ZOOM);
    setZoom(r.zoom);
    setOffset(r.offset);
  }, []);

  // --- paint ----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const f = frameSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = f * dpr;
    canvas.height = f * dpr;
    const { sx, sy, side } = cropRect(offset, img.width, img.height, f, zoom);
    drawCrop(canvas.getContext("2d"), img, sx, sy, side, f * dpr);
  }, [img, zoom, offset]);

  // Re-clamp on resize: rotating a phone changes the frame, and an offset that
  // was legal at the old size can leave a gap at the new one.
  useEffect(() => {
    const onResize = () => setOffset((o) => clamp(o));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  // --- pointers -------------------------------------------------------

  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: live.current.zoom };
      dragRef.current = null;
    } else {
      dragRef.current = startDrag(e.clientX, e.clientY);
    }
  };

  // Where the pointer went down, and where the image was at that moment. Named
  // ox/oy rather than spread from the offset, which would collide with x/y.
  const startDrag = (x, y) => ({
    x,
    y,
    ox: live.current.offset.x,
    oy: live.current.offset.y,
  });

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2 && pinchRef.current?.dist > 0) {
      const [a, b] = [...pointersRef.current.values()];
      applyZoom(pinchRef.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchRef.current.dist));
      return;
    }
    const d = dragRef.current;
    if (d) {
      setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
    }
  };

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
    } else {
      // Lifting one finger of a pinch must not make the image jump: restart the
      // drag from wherever the remaining finger actually is.
      const [p] = [...pointersRef.current.values()];
      dragRef.current = startDrag(p.x, p.y);
    }
  };

  // React's synthetic wheel listener is passive, so preventDefault there is
  // ignored and the page scrolls behind the modal. Bind it directly instead.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !img) return;
    const onWheel = (e) => {
      e.preventDefault();
      applyZoom(live.current.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [img, applyZoom]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function rotate() {
    const cur = live.current.img;
    if (!cur || busy) return;
    const next = await rotateBitmap(cur);
    cur.close?.();
    setImg(next);
    // Recentre: the old offset described an orientation that no longer exists.
    const f = frameSize();
    const z = live.current.zoom;
    setOffset(clamp(centreOffset(next.width, next.height, f, z), z, next));
  }

  // --- export ---------------------------------------------------------

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const { sx, sy, side } = cropRect(offset, img.width, img.height, frameSize(), zoom);
      const canvas = document.createElement("canvas");
      canvas.width = OUT_PX;
      canvas.height = OUT_PX;
      // Same rect and the same call the preview makes — only the size differs.
      drawCrop(canvas.getContext("2d"), img, sx, sy, side, OUT_PX);

      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) throw new Error("couldn't encode the image");
      await onSave(blob);
    } catch (err) {
      setError(err?.message || "Couldn't save that crop.");
      setBusy(false);
    }
  }

  if (!file) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className="modal crop-modal" role="dialog" aria-modal="true" aria-label="Crop your picture">
        <button className="modal-close" onClick={onCancel} aria-label="Cancel">
          <X size={16} />
        </button>

        <h3 className="crop-title">Crop your picture</h3>
        <p className="crop-hint">Drag to move · pinch or scroll to zoom</p>

        <div
          className="crop-frame"
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <canvas ref={canvasRef} className="crop-canvas" />
          {/* Dims everything outside the circle. pointer-events:none, so it
              never swallows a drag. */}
          <div className="crop-mask" />
          {!img && !error && <div className="crop-loading">Loading…</div>}
        </div>

        {error && <p className="crop-error">{error}</p>}

        <div className="crop-zoom">
          <button className="crop-icon-btn" onClick={() => applyZoom(live.current.zoom / 1.2)} aria-label="Zoom out" disabled={!img}>
            <ZoomOut size={15} />
          </button>
          <input
            type="range"
            min="1"
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            aria-label="Zoom"
            disabled={!img}
          />
          <button className="crop-icon-btn" onClick={() => applyZoom(live.current.zoom * 1.2)} aria-label="Zoom in" disabled={!img}>
            <ZoomIn size={15} />
          </button>
          <button className="crop-icon-btn" onClick={rotate} aria-label="Rotate" disabled={!img}>
            <RotateCw size={15} />
          </button>
        </div>

        <div className="crop-actions">
          <button className="mini-btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="mini-btn" onClick={save} disabled={!img || busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
