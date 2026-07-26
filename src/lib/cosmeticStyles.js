// src/lib/cosmeticStyles.js
//
// How a cosmetic's payload turns into CSS. Kept out of Cosmetic.jsx so that
// file exports only a component (mixing helpers in breaks fast refresh).

/**
 * Style + class for a name_style cosmetic.
 *
 * `payload.color` is a flat colour. `payload.gradient` is any CSS
 * background-image, painted through the text — which is what lets the
 * scarcer rewards (the one-year name, the premium ramps) look like more
 * than another hex code. `payload.animated` makes it drift.
 */
export function nameStyleProps(item) {
  const { color, gradient, animated } = item?.payload || {};
  if (gradient) {
    return {
      className: `user-label-name is-gradient${animated ? " is-animated" : ""}`,
      style: { backgroundImage: gradient },
    };
  }
  return {
    className: "user-label-name",
    style: color ? { color } : undefined,
  };
}

/**
 * Preview swatch for any cosmetic. Themes carry `swatch`, name styles carry
 * `color` or `gradient`; a gradient in either slot paints as a ramp.
 */
export function swatchStyle(item) {
  const { color, gradient, swatch } = item?.payload || {};
  return { background: gradient || swatch || color || "#888" };
}
