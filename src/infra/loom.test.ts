/**
 * Tests for loom — index message parsing, ancestry formatting
 *
 * Tests pure functions that don't require Discord API calls.
 * Integration tests for fork/mu/stash require a live bot.
 */

import { describe, it, expect } from 'vitest'
import { parseIndexMessage, formatAncestryChain } from './loom.js'

// ============================================================================
// Mock helpers
// ============================================================================

function mockMessage(overrides: Partial<{
  content: string
  url: string
  components: any[]
  embeds: any[]
}>): any {
  return {
    content: '',
    url: 'https://discord.com/channels/111/222/333',
    components: [],
    embeds: [],
    ...overrides,
  }
}

// ============================================================================
// parseIndexMessage tests
// ============================================================================

describe('parseIndexMessage', () => {
  it('returns null for non-index messages', () => {
    expect(parseIndexMessage(mockMessage({ content: 'hello world' }))).toBeNull()
    expect(parseIndexMessage(mockMessage({ content: '.config\n---\nfoo: bar' }))).toBeNull()
  })

  it('returns null for futures prefix without "of"', () => {
    expect(parseIndexMessage(mockMessage({
      content: '.:twisted_rightwards_arrows: **futures**',
    }))).toBeNull()
  })

  it('parses a futures message with embeds', () => {
    const result = parseIndexMessage(mockMessage({
      content: '.:twisted_rightwards_arrows: **futures** of https://discord.com/channels/111/222/333:',
      embeds: [
        { author: { url: 'https://discord.com/channels/111/222/444' } },
        { author: { url: 'https://discord.com/channels/111/222/555' } },
      ],
    }))
    expect(result).not.toBeNull()
    expect(result!.rootLink).toBe('https://discord.com/channels/111/222/333')
    expect(result!.childrenLinks).toHaveLength(2)
    expect(result!.childrenLinks[0]).toBe('https://discord.com/channels/111/222/444')
  })

  it('parses overflow embeds with "more futures..." title', () => {
    const result = parseIndexMessage(mockMessage({
      content: '.:twisted_rightwards_arrows: **futures** of https://discord.com/channels/111/222/333:',
      embeds: [
        { title: 'more futures...', description: '- https://discord.com/channels/111/222/666\n- https://discord.com/channels/111/222/777' },
      ],
    }))
    expect(result).not.toBeNull()
    expect(result!.childrenLinks).toHaveLength(2)
    expect(result!.childrenLinks[0]).toBe('https://discord.com/channels/111/222/666')
  })

  it('parses select menu format', () => {
    // Mock ActionRow with toJSON() matching discord.js behavior
    const result = parseIndexMessage(mockMessage({
      content: 'anything',
      components: [{
        toJSON: () => ({
          components: [{
            type: 3, // StringSelect
            custom_id: 'loom_select|111/222/333',
            options: [
              { value: '111/222/444', description: 'link1' },
              { value: '111/222/555', description: 'link2' },
            ],
          }],
        }),
      }],
    }))
    expect(result).not.toBeNull()
    expect(result!.rootLink).toBe('https://discord.com/channels/111/222/333')
    expect(result!.childrenLinks).toHaveLength(2)
    expect(result!.childrenLinks[0]).toBe('https://discord.com/channels/111/222/444')
  })

  it('prefers select menu over content parsing', () => {
    const result = parseIndexMessage(mockMessage({
      content: '.:twisted_rightwards_arrows: **futures** of https://discord.com/channels/111/222/WRONG:',
      components: [{
        toJSON: () => ({
          components: [{
            type: 3,
            custom_id: 'loom_select|111/222/CORRECT',
            options: [{ value: '111/222/444', description: 'test' }],
          }],
        }),
      }],
    }))
    expect(result!.rootLink).toBe('https://discord.com/channels/111/222/CORRECT')
  })
})

// ============================================================================
// formatAncestryChain tests
// ============================================================================

describe('formatAncestryChain', () => {
  it('formats a single ancestor (root = current)', () => {
    const msg = mockMessage({ url: 'https://discord.com/channels/1/2/3' })
    const result = formatAncestryChain([msg], new Map(), msg)
    expect(result).toContain('**⌥**')
    expect(result).toContain('https://discord.com/channels/1/2/3')
  })

  it('formats ancestry with increasing indent', () => {
    const root = mockMessage({ url: 'https://discord.com/channels/1/2/root' })
    const mid = mockMessage({ url: 'https://discord.com/channels/1/2/mid' })
    const current = mockMessage({ url: 'https://discord.com/channels/1/2/current' })

    // ancestors are current→root order, formatAncestryChain reverses to root→current
    const result = formatAncestryChain([current, mid, root], new Map(), current)

    const lines = result.split('\n').filter(l => l.trim())
    // Root first (dimmed), then mid (dimmed), then current (bold)
    expect(lines[0]).toContain('- -# ⌥') // root — dimmed
    expect(lines[1]).toContain('  - -# ⌥') // mid — indented, dimmed
    expect(lines[2]).toContain('    - **⌥**') // current — double indent, bold
  })

  it('includes index message links for ancestors', () => {
    const root = mockMessage({ url: 'https://discord.com/channels/1/2/root' })
    const current = mockMessage({ url: 'https://discord.com/channels/1/2/current' })

    const ancestorIndex = new Map([
      ['https://discord.com/channels/1/2/root', 'https://discord.com/channels/1/2/indexmsg'],
    ])

    const result = formatAncestryChain([current, root], ancestorIndex, current)
    expect(result).toContain('[⌥](https://discord.com/channels/1/2/indexmsg)')
  })

  it('handles empty ancestry', () => {
    const result = formatAncestryChain([], new Map(), mockMessage({}))
    expect(result).toBe('')
  })
})
