import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measureViewportGeometry as measure } from '../src/lib/viewportGeometry.js'

test('closed keyboard uses the full app viewport', () => {
  const result = measure({ visualHeight: 844, innerHeight: 844, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 844)
  assert.equal(result.visibleTop, 0)
  assert.equal(result.keyboardOpen, false)
})

test('visual viewport resize docks composer above keyboard', () => {
  const result = measure({ visualHeight: 525, innerHeight: 844, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 525)
  assert.equal(result.keyboardHeight, 319)
  assert.equal(result.keyboardOpen, true)
})

test('native resize and visual resize do not shrink the layout twice', () => {
  const result = measure({ visualHeight: 525, innerHeight: 525, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 525)
  assert.equal(result.keyboardOpen, true)
})

test('incorrectly smaller innerHeight cannot make composer float above keys', () => {
  const result = measure({ visualHeight: 525, innerHeight: 290, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 525)
  assert.equal(result.keyboardOpen, true)
})

test('iOS viewport pan moves chat shell by exactly the native offset', () => {
  const result = measure({ visualHeight: 490, innerHeight: 844, visualOffsetTop: 38, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 490)
  assert.equal(result.visibleTop, 38)
  assert.equal(result.visibleTop + result.viewportHeight, 528)
})

test('falls back to innerHeight if visualViewport is not supported', () => {
  const result = measure({ visualHeight: 470, innerHeight: 470, hasVisualViewport: false, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 470)
  assert.equal(result.visibleTop, 0)
})

test('keyboard dismissal restores full viewport', () => {
  const result = measure({ visualHeight: 844, innerHeight: 844, previousFullHeight: 844 })
  assert.equal(result.viewportHeight, 844)
  assert.equal(result.fullHeight, 844)
  assert.equal(result.keyboardOpen, false)
})

test('small safe-area changes are not mistaken for a keyboard', () => {
  const result = measure({ visualHeight: 828, innerHeight: 844, previousFullHeight: 844 })
  assert.equal(result.keyboardOpen, false)
  assert.equal(result.viewportHeight, 844)
})
