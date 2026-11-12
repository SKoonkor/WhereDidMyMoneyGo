import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme, currentThemeId, setThemeId } from './prefs'

// The theme id lives in localStorage and is mirrored onto <html> as data-theme
// (the token block) and data-scheme (light/dark for the binary rules). The
// sun/moon pill must take a Pixel user back to Pixel, not to plain Dark.

const html = () => document.documentElement
beforeEach(() => {
  localStorage.clear()
  html().removeAttribute('data-theme')
  html().removeAttribute('data-scheme')
})

describe('theme id storage', () => {
  it('defaults to dark, and the existing light/dark values are read unchanged', () => {
    expect(currentThemeId()).toBe('dark')
    localStorage.setItem('pref-theme', 'light')
    expect(currentThemeId()).toBe('light')
    localStorage.setItem('pref-theme', 'dark')
    expect(currentThemeId()).toBe('dark')
  })

  it('an unknown stored value falls back to dark rather than leaving the app unthemed', () => {
    localStorage.setItem('pref-theme', 'neon')
    expect(currentThemeId()).toBe('dark')
    localStorage.setItem('pref-theme', 'constructor') // not fooled by Object.prototype keys
    expect(currentThemeId()).toBe('dark')
  })

  it('writes both attributes; pixel is a dark-scheme theme', () => {
    setThemeId('pixel')
    expect(localStorage.getItem('pref-theme')).toBe('pixel')
    expect(html().getAttribute('data-theme')).toBe('pixel')
    expect(html().getAttribute('data-scheme')).toBe('dark')
    setThemeId('light')
    expect(html().getAttribute('data-theme')).toBe('light')
    expect(html().getAttribute('data-scheme')).toBe('light')
  })
})

describe('useTheme', () => {
  it('toggleScheme goes Light ↔ the last dark-family theme', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.id).toBe('dark')
    act(() => result.current.set('pixel'))
    expect(result.current).toMatchObject({ id: 'pixel', scheme: 'dark' })
    act(() => result.current.toggleScheme())
    expect(result.current.id).toBe('light')
    act(() => result.current.toggleScheme())
    expect(result.current.id).toBe('pixel') // not 'dark'
  })

  it('a remembered "dark" theme that is not actually dark never makes the pill look stuck', () => {
    localStorage.setItem('pref-theme', 'light')
    localStorage.setItem('pref-theme-dark', 'light') // only possible by hand-editing storage
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleScheme())
    expect(result.current.id).toBe('dark')
  })

  it('updates the status-bar colour: Pixel blends in, Light/Dark keep the teal', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#1abc9c'
    document.head.appendChild(meta)
    setThemeId('pixel')
    expect(meta.content).toBe('#0c1a1c')
    setThemeId('dark')
    expect(meta.content).toBe('#1abc9c')
    meta.remove()
  })

  it('with no dark theme chosen before, toggling from Light lands on Dark', () => {
    localStorage.setItem('pref-theme', 'light')
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleScheme())
    expect(result.current.id).toBe('dark')
  })
})
