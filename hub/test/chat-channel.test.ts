import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SynologyChat, type ChatPost } from '../src/chat-channel.js';
import type { Notification } from '../src/notifications.js';

// Alerts through Synology Chat: only Chat webhook addresses, the token kept privately, levels, and Chat's refusals.
const URL_OK = 'https://192.168.1.20:5001/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=%22abc123%22';
const note = (level: Notification['level'], title: string): Notification => ({ id: 1, at: 0, level, title, body: '', ieee: null, ruleId: null, repeats: 0, read: false });

function setup(answer = { status: 200, text: '{"success":true}' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-chat-'));
  const posts: Array<{ url: string; body: string }> = [];
  const post: ChatPost = async (url, body) => (posts.push({ url, body }), answer);
  return { dir, posts, chat: new SynologyChat(dir, post) };
}

describe('Synology Chat channel', () => {
  it('accepts only incoming webhook addresses, keeps them owner-only and shows them without the token', () => {
    const { dir, chat } = setup();
    expect(chat.view()).toEqual({ configured: false, address: null, minLevel: 'warning' });
    expect(() => chat.save({ url: 'https://example.com/hook' })).toThrow(/incoming webhook/);
    expect(() => chat.save({ url: 'not a url' })).toThrow(/web address/);
    expect(chat.save({ url: URL_OK, minLevel: 'alarm' })).toEqual({ configured: true, address: 'https://192.168.1.20:5001/webapi/entry.cgi', minLevel: 'alarm' });
    expect(JSON.stringify(chat.view())).not.toContain('abc123');
    expect(fs.statSync(path.join(dir, 'synology-chat.json')).mode & 0o777).toBe(0o600);
    // Changing only the level keeps the address.
    expect(chat.save({ minLevel: 'info' }).minLevel).toBe('info');
    expect(chat.settings()!.url).toContain('abc123');
    chat.clear();
    expect(chat.view().configured).toBe(false);
  });

  it('posts notifications at or above the chosen level, form-encoded as Chat expects', async () => {
    const { chat, posts } = setup();
    chat.save({ url: URL_OK, minLevel: 'warning' });
    await chat.deliver(note('info', 'Just so you know'));
    await chat.deliver(note('warning', 'Balcony door is open'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(URL_OK.replace('%22abc123%22', '%22abc123%22'));
    expect(JSON.parse(decodeURIComponent(posts[0]!.body.replace(/^payload=/, '')))).toEqual({ text: '⚠️ Balcony door is open' });
  });

  it("reports Chat's refusal", async () => {
    const { chat } = setup({ status: 200, text: '{"success":false,"error":{"code":404}}' });
    chat.save({ url: URL_OK });
    await expect(chat.send('x')).rejects.toThrow(/refused it \(error 404\)/);
    await expect(new SynologyChat(fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-chat-'))).send('x')).rejects.toThrow(/not set up/);
  });
});

describe('pausing alerts', () => {
  it('holds back Chat posts while paused, and resumes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-chat-'));
    const posts: string[] = [];
    let paused: { by: string } | null = { by: 'Anna (Pixel)' };
    const chat = new SynologyChat(dir, async (_u, body) => (posts.push(body), { status: 200, text: '{"success":true}' }), () => paused);
    chat.save({ url: URL_OK, minLevel: 'info' });
    await chat.deliver(note('alarm', 'Leak'));
    expect(posts).toHaveLength(0);
    paused = null;
    await chat.deliver(note('alarm', 'Leak'));
    expect(posts).toHaveLength(1);
  });
});
