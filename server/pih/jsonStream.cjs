'use strict';
// Streams the elements of a top-level JSON array one at a time, without loading the whole file.
// Each element is returned as its ORIGINAL text (exact slice of the file) so the importer can store it unchanged.
// Zero dependencies. The file is opened read-only. Error messages never contain file content.
const fs = require('fs');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

const MAX_ELEMENT_CHARS = 200 * 1024 * 1024; // one conversation larger than this is reported, not loaded

function sha256File(file, { chunkSize = 1 << 20 } = {}) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file, { flags: 'r', highWaterMark: chunkSize });
    s.on('data', (c) => h.update(c));
    s.on('error', (e) => reject(new Error(`cannot read file (${e.code || 'error'})`)));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// Async generator. Yields { index, text } for each array element and { error, fatal } for problems.
// A fatal problem (not an array, file ends early, junk between elements) ends the iteration after the yield.
async function* streamArrayElements(file, { chunkSize = 1 << 20, maxElementChars = MAX_ELEMENT_CHARS } = {}) {
  const stream = fs.createReadStream(file, { flags: 'r', highWaterMark: chunkSize });
  const decoder = new StringDecoder('utf8');
  let started = false; // saw the opening [
  let finished = false; // saw the closing ]
  let depth = 0; // nesting inside the current element
  let inStr = false;
  let esc = false;
  let parts = []; // pieces of the current element
  let elementChars = 0;
  let index = 0;
  let skipping = false; // current element is over the size limit: count, do not keep
  let first = true;

  const handle = async function* (chunk) {
    let segStart = depth > 0 ? 0 : -1; // start of the current element's piece inside this chunk (0 when it continues from the last chunk)
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk.charCodeAt(i);
      if (finished) {
        if (ch === 32 || ch === 10 || ch === 13 || ch === 9 || ch === 0xfeff) continue;
        yield { error: 'unexpected content after the closing bracket', fatal: true };
        return 'stop';
      }
      if (!started) {
        if (ch === 32 || ch === 10 || ch === 13 || ch === 9 || ch === 0xfeff) continue;
        if (ch === 0x5b) { started = true; continue; } // [
        yield { error: 'top-level value is not a JSON array', fatal: true };
        return 'stop';
      }
      if (depth === 0) {
        // between elements
        if (ch === 32 || ch === 10 || ch === 13 || ch === 9 || ch === 0x2c) continue; // whitespace or comma
        if (ch === 0x5d) { finished = true; continue; } // ]
        if (ch === 0x7b) { // { starts an element
          depth = 1; inStr = false; esc = false; parts = []; elementChars = 0; skipping = false; segStart = i; continue;
        }
        yield { error: 'unexpected content between conversations (expected an object)', fatal: true };
        return 'stop';
      }
      // inside an element
      if (inStr) {
        if (esc) esc = false;
        else if (ch === 0x5c) esc = true;
        else if (ch === 0x22) inStr = false;
        continue;
      }
      if (ch === 0x22) inStr = true;
      else if (ch === 0x7b || ch === 0x5b) depth++;
      else if (ch === 0x7d || ch === 0x5d) {
        depth--;
        if (depth === 0) {
          const piece = chunk.slice(segStart, i + 1);
          elementChars += piece.length;
          if (elementChars > maxElementChars) { skipping = true; parts = []; }
          if (!skipping) parts.push(piece);
          const text = skipping ? null : parts.join('');
          parts = []; segStart = -1;
          const idx = index++;
          if (skipping) yield { index: idx, error: 'conversation is larger than the size limit and was not loaded' };
          else yield { index: idx, text };
        }
      }
    }
    if (depth > 0 && segStart !== -1) {
      const piece = chunk.slice(segStart);
      elementChars += piece.length;
      if (elementChars > maxElementChars) { skipping = true; parts = []; }
      else parts.push(piece);
    }
    return 'more';
  };

  try {
    for await (const buf of stream) {
      const chunk = decoder.write(buf);
      if (!chunk) continue;
      const gen = handle(chunk);
      let r;
      for (;;) {
        const n = await gen.next();
        if (n.done) { r = n.value; break; }
        yield n.value;
      }
      if (r === 'stop') { stream.destroy(); return; }
      first = false;
    }
    const tail = decoder.end();
    if (tail) { /* a dangling partial character: file ends early */ }
  } catch (e) {
    yield { error: `cannot read file (${e.code || 'error'})`, fatal: true };
    return;
  }
  if (!started) { yield { error: first ? 'file is empty' : 'top-level value is not a JSON array', fatal: true }; return; }
  if (!finished) yield { error: `file ends unexpectedly${depth > 0 ? ' inside a conversation (file looks truncated)' : ' (missing closing bracket)'}`, fatal: true };
}

module.exports = { streamArrayElements, sha256File, MAX_ELEMENT_CHARS };
