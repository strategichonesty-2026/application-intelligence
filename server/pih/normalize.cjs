'use strict';
// Turns one parsed conversation object into plain rows. Read-only on its input; never changes the original.
// Error messages are generic on purpose: they must never echo conversation content.

class ParseError extends Error { constructor(msg) { super(msg); this.name = 'ParseError'; } }

const MIN_MS = Date.UTC(1990, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

function newStats() { return { timestampsMissing: 0, timestampsInvalid: 0, nulCharsRemoved: 0, unreadableMessages: 0 }; }

// Returns a Date or null. Missing and invalid values become null (never guessed) and are counted.
function toDate(v, stats) {
  if (v === undefined || v === null || v === '') { stats.timestampsMissing++; return null; }
  let ms = NaN;
  if (typeof v === 'number' && Number.isFinite(v)) ms = v * 1000; // ChatGPT: Unix seconds
  else if (typeof v === 'string' && /[-T:]/.test(v)) ms = Date.parse(v); // Claude: ISO 8601
  if (!Number.isFinite(ms) || ms < MIN_MS || ms >= MAX_MS) { stats.timestampsInvalid++; return null; }
  return new Date(ms);
}

function clean(s, stats) {
  if (typeof s !== 'string') return '';
  if (s.indexOf('\u0000') === -1) return s;
  stats.nulCharsRemoved += s.split('\u0000').length - 1; // PostgreSQL text cannot hold NUL; the raw copy keeps the escaped original
  return s.replace(/\u0000/g, '');
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function detectPlatform(obj) {
  if (!isObj(obj)) return null;
  if (isObj(obj.mapping)) return 'chatgpt';
  if (Array.isArray(obj.chat_messages)) return 'claude';
  return null;
}

const ROLES = new Set(['user', 'assistant', 'system', 'tool']);
function role(r) { const x = typeof r === 'string' ? r.toLowerCase() : ''; if (x === 'human') return 'user'; return ROLES.has(x) ? x : 'unknown'; }

// ---------- ChatGPT ----------
function chatgptText(content) {
  const out = { text: '', contentType: null, attachment: false, unreadable: false };
  if (!isObj(content)) return out;
  out.contentType = typeof content.content_type === 'string' ? content.content_type : null;
  const pieces = [];
  let unknownPart = false;
  if (Array.isArray(content.parts)) {
    for (const p of content.parts) {
      if (typeof p === 'string') { if (p) pieces.push(p); } else if (isObj(p)) {
        if (typeof p.text === 'string') pieces.push(p.text);
        else if (/asset_pointer|image|audio|video|file/i.test(String(p.content_type || ''))) out.attachment = true;
        else unknownPart = true;
      }
    }
  }
  if (typeof content.text === 'string' && content.text) pieces.push(content.text); // code, execution output
  if (Array.isArray(content.thoughts)) for (const t of content.thoughts) if (isObj(t) && typeof t.content === 'string' && t.content) pieces.push(t.content);
  out.text = pieces.join('\n');
  out.unreadable = !out.text && !out.attachment && unknownPart;
  return out;
}

function parseChatgpt(obj, stats) {
  if (!isObj(obj.mapping)) throw new ParseError('conversation has no "mapping" object');
  const mapping = obj.mapping;
  const warnings = [];
  const ids = Object.keys(mapping);

  // active branch: current_node up through parents
  let leaf = typeof obj.current_node === 'string' && mapping[obj.current_node] ? obj.current_node : null;
  if (!leaf) {
    // no usable current_node: use the latest node that has no children (recorded as a warning, not guessed silently)
    let best = null; let bestT = -Infinity;
    for (const id of ids) {
      const n = mapping[id];
      if (!isObj(n) || (Array.isArray(n.children) && n.children.length)) continue;
      const t = isObj(n.message) && typeof n.message.create_time === 'number' ? n.message.create_time : -1;
      if (best === null || t > bestT) { best = id; bestT = t; }
    }
    leaf = best;
    if (ids.length) warnings.push('current_node missing or unknown; the latest leaf was used as the active branch');
  }
  const active = [];
  const seen = new Set();
  for (let id = leaf; id && mapping[id] && !seen.has(id); id = isObj(mapping[id]) ? mapping[id].parent : null) { seen.add(id); active.push(id); }
  active.reverse();
  const activeSet = new Set(active);

  const order = [...active, ...ids.filter((id) => !activeSet.has(id)).sort((a, b) => {
    const ta = isObj(mapping[a]) && isObj(mapping[a].message) && typeof mapping[a].message.create_time === 'number' ? mapping[a].message.create_time : Infinity;
    const tb = isObj(mapping[b]) && isObj(mapping[b].message) && typeof mapping[b].message.create_time === 'number' ? mapping[b].message.create_time : Infinity;
    return ta - tb;
  })];

  const messages = [];
  let pos = 0;
  for (const id of order) {
    const node = mapping[id];
    if (!isObj(node) || !isObj(node.message)) continue; // the root node has no message
    const m = node.message;
    const isActive = activeSet.has(id);
    const t = chatgptText(m.content);
    if (t.unreadable) stats.unreadableMessages++;
    const hidden = !!(isObj(m.metadata) && m.metadata.is_visually_hidden_from_conversation === true);
    messages.push({
      position: isActive ? pos++ : null,
      sourceId: typeof m.id === 'string' ? m.id : id,
      role: role(isObj(m.author) ? m.author.role : null),
      text: clean(t.text, stats),
      createdAt: toDate(m.create_time, stats),
      activeBranch: isActive,
      hidden,
      contentType: t.contentType,
      hasAttachment: t.attachment,
      unreadable: t.unreadable,
    });
  }
  const externalId = typeof obj.conversation_id === 'string' && obj.conversation_id ? obj.conversation_id : (typeof obj.id === 'string' && obj.id ? obj.id : null);
  return {
    platform: 'chatgpt', externalId,
    title: clean(typeof obj.title === 'string' ? obj.title : '', stats),
    createdAt: toDate(obj.create_time, stats), updatedAt: toDate(obj.update_time, stats),
    messages, warnings,
  };
}

// ---------- Claude ----------
function claudeText(m) {
  const out = { text: '', contentType: null, attachment: false, unreadable: false };
  const types = [];
  const blocks = [];
  if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (!isObj(b)) continue;
      if (typeof b.type === 'string' && !types.includes(b.type)) types.push(b.type);
      if (b.type === 'text' && typeof b.text === 'string' && b.text) blocks.push(b.text);
    }
  }
  out.contentType = types.length ? types.join(',') : (typeof m.text === 'string' ? 'text' : null);
  // "text" is the message as shown; content blocks are the fallback when it is empty
  out.text = typeof m.text === 'string' && m.text ? m.text : blocks.join('\n');
  out.attachment = (Array.isArray(m.attachments) && m.attachments.length > 0) || (Array.isArray(m.files) && m.files.length > 0);
  return out;
}

function parseClaude(obj, stats) {
  if (!Array.isArray(obj.chat_messages)) throw new ParseError('conversation has no "chat_messages" list');
  const messages = [];
  let pos = 0;
  for (const m of obj.chat_messages) {
    if (!isObj(m)) { stats.unreadableMessages++; messages.push({ position: pos++, sourceId: null, role: 'unknown', text: '', createdAt: null, activeBranch: true, hidden: false, contentType: null, hasAttachment: false, unreadable: true }); stats.timestampsMissing++; continue; }
    const t = claudeText(m);
    messages.push({
      position: pos++,
      sourceId: typeof m.uuid === 'string' ? m.uuid : null,
      role: role(m.sender),
      text: clean(t.text, stats),
      createdAt: toDate(m.created_at, stats),
      activeBranch: true, hidden: false,
      contentType: t.contentType, hasAttachment: t.attachment, unreadable: false,
    });
  }
  return {
    platform: 'claude',
    externalId: typeof obj.uuid === 'string' && obj.uuid ? obj.uuid : null,
    title: clean(typeof obj.name === 'string' ? obj.name : '', stats),
    createdAt: toDate(obj.created_at, stats), updatedAt: toDate(obj.updated_at, stats),
    messages, warnings: [],
  };
}

// Parses one conversation. `rawText` is the exact original text; it is only read, never altered.
function parseConversation(rawText, platformHint) {
  let obj;
  try { obj = JSON.parse(rawText); } catch (e) {
    // Node's own message can quote part of the text; keep only the kind of error.
    throw new ParseError('conversation is not valid JSON');
  }
  if (!isObj(obj)) throw new ParseError('conversation is not a JSON object');
  const platform = platformHint || detectPlatform(obj);
  if (!platform) throw new ParseError('conversation has neither "mapping" (ChatGPT) nor "chat_messages" (Claude)');
  const stats = newStats();
  const parsed = platform === 'chatgpt' ? parseChatgpt(obj, stats) : parseClaude(obj, stats);
  return { ...parsed, stats };
}

module.exports = { parseConversation, detectPlatform, ParseError, newStats };
