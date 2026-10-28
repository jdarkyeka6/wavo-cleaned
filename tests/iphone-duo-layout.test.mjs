import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPANDED_NATIVE_WIDTH,
  getNativeWindowClass,
  shouldResetViewportHeight,
} from '../src/lib/window-size.js'

test('Duo outer and inner window layout follows available width', () => {
  assert.equal(EXPANDED_NATIVE_WIDTH, 700)
  assert.equal(getNativeWindowClass(390, true), 'compact')
  assert.equal(getNativeWindowClass(466, true), 'compact')
  assert.equal(getNativeWindowClass(699, true), 'compact')
  assert.equal(getNativeWindowClass(700, true), 'expanded')
  assert.equal(getNativeWindowClass(890, true), 'expanded')
  assert.equal(getNativeWindowClass(626, true), 'compact')
})

test('a wide browser window is not mistaken for a native Duo window', () => {
  assert.equal(getNativeWindowClass(1100, false), 'compact')
  assert.equal(getNativeWindowClass(0, true), 'compact')
  assert.equal(getNativeWindowClass(NaN, true), 'compact')
})

test('fold and rotation reset viewport baseline; keyboard does not', () => {
  assert.equal(shouldResetViewportHeight(890, 466), true)
  assert.equal(shouldResetViewportHeight(466, 890), true)
  assert.equal(shouldResetViewportHeight(890, 626), true)
  assert.equal(shouldResetViewportHeight(890, 890), false)
  assert.equal(shouldResetViewportHeight(890, 854), false)
  assert.equal(shouldResetViewportHeight(0, 890), false)
})
