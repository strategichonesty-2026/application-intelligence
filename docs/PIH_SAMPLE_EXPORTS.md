# PIH: sample export formats and how to remove sensitive information before sharing a sample

Purpose: let the first importer be built and tested on **real shapes** without you handing over any private conversation.
**Never send a full export.** Send only the structure-only sample this page shows you how to make, after you have looked at it yourself.

## 1. What the two exports look like (small synthetic examples)
These are **made up** and reconstructed from public documentation and third-party parser projects. They are **not verified against your real files** (fields change over time); the sample you send is what lets us check.

### ChatGPT (`conversations.json`, or `conversations-000.json`... in newer exports)
A list of conversations. Messages are a **graph** (`mapping`), not a list, because edits and regenerated answers create branches; `current_node` is the end of the branch you were viewing.
```json
[{"title":"Plan my product launch with jane@example.com","create_time":1731000000.5,"update_time":1731000600.0,"conversation_id":"11111111-2222-3333-4444-555555555555","current_node":"cccccccc-0000-0000-0000-000000000003","mapping":{"aaaaaaaa-0000-0000-0000-000000000001":{"id":"aaaaaaaa-0000-0000-0000-000000000001","parent":null,"children":["bbbbbbbb-0000-0000-0000-000000000002"],"message":null},"bbbbbbbb-0000-0000-0000-000000000002":{"id":"bbbbbbbb-0000-0000-0000-000000000002","parent":"aaaaaaaa-0000-0000-0000-000000000001","children":["cccccccc-0000-0000-0000-000000000003"],"message":{"id":"bbbbbbbb-0000-0000-0000-000000000002","author":{"role":"user","name":null},"create_time":1731000010.1,"content":{"content_type":"text","parts":["My phone is 612-555-0100, help me plan the launch"]},"status":"finished_successfully"}},"cccccccc-0000-0000-0000-000000000003":{"id":"cccccccc-0000-0000-0000-000000000003","parent":"bbbbbbbb-0000-0000-0000-000000000002","children":[],"message":{"id":"cccccccc-0000-0000-0000-000000000003","author":{"role":"assistant","name":null},"create_time":1731000020.2,"content":{"content_type":"text","parts":["Here is a launch plan..."]},"metadata":{"model_slug":"gpt-x"},"status":"finished_successfully","recipient":"all"}}}}]
```

### Claude (`conversations.json` in the export ZIP)
A list of conversations with a plain `chat_messages` list. `text` can be empty for some turns; newer messages carry the text inside `content` blocks.
```json
[{"uuid":"99999999-8888-7777-6666-555555555555","name":"Pricing ideas for Acme Corp","created_at":"2026-03-05T10:30:00.123456Z","updated_at":"2026-03-05T11:45:00.000000Z","chat_messages":[{"uuid":"aaaaaaaa-1111-2222-3333-444444444444","sender":"human","text":"What should Acme Corp charge? my email is joe@example.com","content":[{"type":"text","text":"What should Acme Corp charge?"}],"created_at":"2026-03-05T10:30:00.123456Z","attachments":[{"file_name":"budget.xlsx","file_size":1234}],"files":[]},{"uuid":"bbbbbbbb-1111-2222-3333-444444444444","sender":"assistant","text":"","content":[{"type":"text","text":"Consider three tiers..."}],"created_at":"2026-03-05T10:30:05.000000Z","attachments":[],"files":[]}]}]
```

## 2. Best option: a throwaway sample (no redaction needed)
1. In each product, start a **new** chat about something harmless (for example "plan a picnic"), with 3 to 6 messages, one regenerated answer in ChatGPT, one pasted file or code block if you like.
2. Request a fresh export from each product (ChatGPT: Settings → Data controls → Export data; Claude: Settings → Privacy → Export data). Both are emailed as a ZIP.
3. Open the ZIP **on your computer**, find `conversations.json` (or the numbered shard), and use the next section to keep only your throwaway chats.

## 3. If you use real conversations: make a structure-only sample
The script below keeps field names, ids, roles, counts, numbers and timestamps, and replaces **every piece of text** (titles, messages, names, file names, emails) with a placeholder such as `[text 37 chars]`. It reads one file and writes another; it sends nothing anywhere.

Save it as `redact_sample.py` in a folder on your computer **outside any Git repository**, then:
```bash
python3 redact_sample.py conversations.json sample.json --max-conversations 3
```
```python
#!/usr/bin/env python3
"""Make a STRUCTURE-ONLY sample of a ChatGPT or Claude export file.

Keeps: field names, nesting, roles/senders, ids, counts, numbers, booleans, dates/times.
Replaces: every other piece of text (titles, messages, names, file names, emails ...) with a placeholder
such as "[text 37 chars]". Nothing is sent anywhere; it reads one file and writes another.
Usage:  python3 redact_sample.py conversations.json sample.json --max-conversations 3
"""
import json, re, sys, argparse

KEEP_KEYS = {  # strings under these keys are structure, not content
    'role', 'sender', 'content_type', 'type', 'model_slug', 'default_model_slug', 'status', 'end_turn',
    'recipient', 'channel', 'source', 'content_type', 'current_node', 'parent', 'id', 'uuid', 'message_id',
    'conversation_id', 'create_time', 'update_time', 'created_at', 'updated_at', 'timestamp', 'is_archived',
}
UUID = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
ROLES = {'user', 'assistant', 'system', 'tool', 'human'}

def walk(v, key=None):
    if isinstance(v, dict):
        # dict KEYS are kept (they are node ids or field names); only values are rewritten
        return {k: walk(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [walk(x, key) for x in v]
    if isinstance(v, str):
        if key in KEEP_KEYS and (UUID.match(v) or ISO.match(v) or v in ROLES or len(v) <= 40):
            if key in ('id', 'uuid', 'message_id', 'conversation_id', 'parent', 'current_node') and not (UUID.match(v) or v == 'client-created-root'):
                return '[id]'
            return v
        return f'[text {len(v)} chars]'
    return v  # numbers, booleans, null

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--max-conversations', type=int, default=3)
    a = ap.parse_args()
    data = json.load(open(a.src, encoding='utf-8'))
    if isinstance(data, dict):  # some exports wrap the list
        data = next((x for x in data.values() if isinstance(x, list)), [data])
    out = [walk(c) for c in data[:a.max_conversations]]
    json.dump(out, open(a.dst, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'wrote {len(out)} of {len(data)} conversations (text replaced by placeholders) to {a.dst}')

if __name__ == '__main__':
    sys.exit(main())
```

### Check the result before you share it (2 minutes)
1. Open `sample.json` in a text editor. Every message should read like `[text 120 chars]`. If you can read any real sentence, name, email, phone, key or link, **do not share it**.
2. Search the file for `@`, `http`, `key`, `token`, `password`, `sk-`, `ghp_`, `AKIA`, digits that look like phone or account numbers. Nothing real should be found.
3. Choose conversations that are not family, health or financial, even though the text is removed (titles and counts still reveal a little).
4. Share only `sample.json` (not the ZIP, not the original), with me through the channel you prefer; or keep it local and tell me the field names it contains.

## 4. What the sample tells us
Which files and field names your exports really use, how timestamps look, how branches and empty messages appear, how attachments are listed, and the typical size of one conversation. That is enough to write and test the importer; the real import then runs on your computer, never through chat.

## 5. Safety notes
- The original ZIP stays on your computer as your master copy; nothing in this process modifies it.
- Do not upload an export to any third-party converter site to "clean" it.
- If you ever shared a file by mistake, tell me and we treat anything in it as exposed (rotate any key found in it).
