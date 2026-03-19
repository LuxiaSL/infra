/**
 * Tests for config-message — dot-command formatting
 */

import { describe, it, expect } from 'vitest'
import { compileConfigMessage } from './config-message.js'

describe('compileConfigMessage', () => {
  it('generates a basic .config message', () => {
    const result = compileConfigMessage('config', { temperature: 0.8 })
    expect(result).toBe('.config\n---\ntemperature: 0.8')
  })

  it('generates a .history message with last link', () => {
    const result = compileConfigMessage('history', {
      last: 'https://discord.com/channels/111/222/333',
    })
    expect(result).toContain('.history')
    expect(result).toContain('---')
    expect(result).toContain('last: https://discord.com/channels/111/222/333')
  })

  it('generates a .history message with all fields', () => {
    const result = compileConfigMessage('history', {
      first: 'https://discord.com/channels/111/222/100',
      last: 'https://discord.com/channels/111/222/333',
      passthrough: true,
    })
    expect(result).toContain('first:')
    expect(result).toContain('last:')
    expect(result).toContain('passthrough: true')
  })

  it('includes targets as mentions', () => {
    const result = compileConfigMessage('config', { mute: true }, ['botA', 'botB'])
    expect(result.startsWith('.config botA botB')).toBe(true)
    expect(result).toContain('mute: true')
  })

  it('filters out null and undefined values', () => {
    const result = compileConfigMessage('config', {
      temperature: 0.8,
      top_p: null,
      max_tokens: undefined,
    })
    expect(result).toContain('temperature')
    expect(result).not.toContain('top_p')
    expect(result).not.toContain('max_tokens')
  })

  it('generates empty YAML when no config provided', () => {
    const result = compileConfigMessage('history')
    expect(result).toBe('.history\n---\n')
  })

  it('generates empty YAML for empty config dict', () => {
    const result = compileConfigMessage('config', {})
    expect(result).toBe('.config\n---\n')
  })

  it('handles multiple config keys', () => {
    const result = compileConfigMessage('config', {
      temperature: 0.7,
      max_tokens: 500,
      mute: false,
    })
    expect(result).toContain('temperature: 0.7')
    expect(result).toContain('max_tokens: 500')
    expect(result).toContain('mute: false')
  })

  it('handles array values (may_speak)', () => {
    const result = compileConfigMessage('config', {
      may_speak: ['botA', 'botB', 'botC'],
    })
    expect(result).toContain('may_speak:')
    expect(result).toContain('botA')
    expect(result).toContain('botB')
  })
})
