/**
 * Tests for discord-utils — link parsing, text preview, embed construction
 */

import { describe, it, expect } from 'vitest'
import { parseMessageLink, minifyLink, reconstructLink, messagePreviewText } from './discord-utils.js'

describe('parseMessageLink', () => {
  it('parses a standard Discord message link', () => {
    const result = parseMessageLink('https://discord.com/channels/123456/789012/345678')
    expect(result).toEqual({
      guildId: '123456',
      channelId: '789012',
      messageId: '345678',
    })
  })

  it('parses a PTB Discord link', () => {
    const result = parseMessageLink('https://ptb.discord.com/channels/123/456/789')
    expect(result).toEqual({
      guildId: '123',
      channelId: '456',
      messageId: '789',
    })
  })

  it('parses a canary Discord link', () => {
    const result = parseMessageLink('https://canary.discord.com/channels/111/222/333')
    expect(result).toEqual({
      guildId: '111',
      channelId: '222',
      messageId: '333',
    })
  })

  it('parses a discordapp.com link', () => {
    const result = parseMessageLink('https://discordapp.com/channels/111/222/333')
    expect(result).toEqual({
      guildId: '111',
      channelId: '222',
      messageId: '333',
    })
  })

  it('returns null for non-Discord links', () => {
    expect(parseMessageLink('https://google.com')).toBeNull()
    expect(parseMessageLink('not a link')).toBeNull()
    expect(parseMessageLink('')).toBeNull()
  })

  it('returns null for malformed Discord links', () => {
    expect(parseMessageLink('https://discord.com/channels/123')).toBeNull()
    expect(parseMessageLink('https://discord.com/channels/123/456')).toBeNull()
  })
})

describe('minifyLink / reconstructLink', () => {
  it('minifies a full link to guild/channel/message', () => {
    expect(minifyLink('https://discord.com/channels/111/222/333')).toBe('111/222/333')
  })

  it('reconstructs a minified link to full URL', () => {
    expect(reconstructLink('111/222/333')).toBe('https://discord.com/channels/111/222/333')
  })

  it('round-trips correctly', () => {
    const original = 'https://discord.com/channels/123456/789012/345678'
    expect(reconstructLink(minifyLink(original))).toBe(original)
  })

  it('returns the input unchanged if not a valid link', () => {
    expect(minifyLink('not a link')).toBe('not a link')
  })
})

describe('messagePreviewText', () => {
  // Mock message objects for testing
  const mockMessage = (content: string) => ({
    content,
  }) as any

  it('returns content when shorter than maxLength', () => {
    expect(messagePreviewText(mockMessage('hello'), 20)).toBe('hello')
  })

  it('truncates from start when anchorAtEnd is true', () => {
    const result = messagePreviewText(mockMessage('this is a very long message'), 10, true)
    expect(result).toBe('...ng message')
    expect(result.length).toBeLessThanOrEqual(13) // 10 + '...'
  })

  it('truncates from end when anchorAtEnd is false', () => {
    const result = messagePreviewText(mockMessage('this is a very long message'), 10, false)
    expect(result).toBe('this is a ...')
  })

  it('strips mentions', () => {
    const result = messagePreviewText(mockMessage('<@123456> hello'))
    expect(result).not.toContain('<@123456>')
    expect(result).toContain('hello')
  })

  it('strips channel mentions', () => {
    const result = messagePreviewText(mockMessage('<#123456> test'))
    expect(result).not.toContain('<#123456>')
  })

  it('strips code blocks', () => {
    const result = messagePreviewText(mockMessage('before ```code here``` after'))
    expect(result).not.toContain('code here')
    expect(result).toContain('[code]')
  })

  it('returns "untitled" for empty content', () => {
    expect(messagePreviewText(mockMessage(''))).toBe('untitled')
  })
})
