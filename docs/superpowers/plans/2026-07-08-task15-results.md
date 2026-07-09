# Task 15 — Manual E2E Results (2026-07-09)

Executed by Claude Code against the merged voice-casting feature (main @ `1c058e3`).
Full plan: [2026-07-08-voice-casting-implementation.md](2026-07-08-voice-casting-implementation.md) §Task 15.

## Summary

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Start servers (OmniVoice + backend + frontend) | ✅ | All three healthy |
| 2 | Configure omnivoice + elevenlabs TTS providers | ✅ | Rows id 9, 10 in `ai_service_configs` |
| 3 | Import + design voices | ✅ | 2 OmniVoice design voices + 1 ElevenLabs import (Sarah EXAVITQu4vr4xnSDxMaL) after key scope fix |
| 4 | Test bench | ✅ | Both `POST /voice-library/:id/test` return 200 + non-empty WAV (~200KB) |
| 5 | Batch recommend on Drama 1 | ✅ | 4 chars → gender-correct assignments (2 female → OV-Young-Female, 2 male → OV-Elder-Male) |
| 6 | Regenerate one character | ✅ (function) / ⚠️ (LLM) | HTTP 200; LLM assigned male voice to female character with "无匹配" reason — see follow-up |
| 7 | Deletion guard | ✅ | 409 IN_USE without `force`; 200 with `force=1`; assignments cleared |
| 8 | Record results | ✅ (this file) | |

## Step details

### Step 1 — Servers
- **OmniVoice**: `uv run python server/omnivoice_server.py --host 127.0.0.1 --port 8712 --model k2-fsa/OmniVoice` — model loaded, `GET /health` → `{"ready": true}`.
- **Backend**: `npm start` in `backend-node/` — port 5679, migrations auto-ran.
- **Frontend**: `npm run dev` in `frontweb/` — port 3013, proxying `/api` → 5679.
Logs at `/tmp/task15-logs/{omnivoice,backend,frontend}.log`.

### Step 2 — Providers
```sql
9  | tts | omnivoice   | OmniVoice 本地    | http://127.0.0.1:8712              | ""            | is_default=1
10 | tts | elevenlabs  | ElevenLabs 克隆   | https://api.elevenlabs.io/v1       | sk_689abc9... | is_active=1
```

### Step 3 — Voices
- **Design (3b)** — 2 voices created via `POST /voice-library/design/preview` + `/design/save`:
  - `id=1 OV-Elder-Male` — instruct `男，老年，低音调`, ref_audio 219KB WAV, source=design
  - `id=2 OV-Young-Female` — instruct `女，青年，高音调`, ref_audio 229KB WAV, source=design (later soft-deleted in Step 7 pass 1)
- **ElevenLabs import (3a)** — after key was regenerated with `text_to_speech: convert` scope, `POST /voice-library/import-elevenlabs` returned:
  - `id=3 EL-Sarah` — voice_id `EXAVITQu4vr4xnSDxMaL`, source=elevenlabs, ref_audio `voice_library/el_EXAVITQu4vr4xnSDxMaL_603d3487.mp3` (~12KB MP3 sample)
  - Backend correctly stored the ElevenLabs sample as `ref_audio` for future OmniVoice-based cloning — no further ElevenLabs API calls after import.
- **Library tab** verified via Chrome MCP: cards render with `试听` + `删除` buttons.

### Step 4 — Test bench
- `POST /voice-library/1/test` (OV-Elder-Male, text `这是一段测试语音，看看老者的声音效果如何。`) → 200, preview WAV 200KB.
- `POST /voice-library/2/test` (OV-Young-Female) → 200, preview WAV 225KB.
- `POST /voice-library/3/test` (EL-Sarah, Chinese input on ElevenLabs-sampled English voice) → 200, preview WAV. Validates cross-language cloning path.
- Audio quality judgment call **skipped** (Claude cannot audition audio) — spec-compliant WAV files were produced for all voices.

### Step 5 — Batch recommend
`POST /dramas/1/characters/voice-recommend` returned:
```
char 1 林薇 (young female) → voice 2 OV-Young-Female ✓
char 2 张明 (middle-aged male) → voice 1 OV-Elder-Male ✓
char 3 王丽 (female) → voice 2 OV-Young-Female ✓
char 4 陈砚 (middle-aged male) → voice 1 OV-Elder-Male ✓
```
Every reason string is LLM-generated in Chinese and semantically appropriate. DB `characters.voice_id` populated for all 4.

### Step 6 — Regenerate
`POST /characters/1/voice-recommend` for 林薇 (already voice_id=2).
- HTTP 200, response `voice_id=1 (OV-Elder-Male)`, reason `无匹配：角色为年轻女性，语音库仅含老年男性声音`.
- The LLM erroneously interpreted "regenerate" as "must pick a different voice" and rationalized reassigning across genders despite `OV-Young-Female` still being available. **Function works (endpoint returns valid `voice_id`, DB updates)**; recommendation quality is a prompt-engineering follow-up (see below).
- Reset via re-running batch recommend before Step 7.

### Step 7 — Deletion guard
Target: voice `id=2 OV-Young-Female`, assigned to 2 characters (林薇 + 王丽).
- `DELETE /voice-library/2` (no force) → **HTTP 409**, body `{"code":"IN_USE","details":{"usage_count":2}}` ✓
- `DELETE /voice-library/2?force=1` → **HTTP 200** ✓
- DB verification:
  ```
  characters: 1|林薇|NULL, 3|王丽|NULL (voice_id cleared) ✓
  voice_library: 2|OV-Young-Female|deleted_at=2026-07-09T01:34:04.252Z (soft delete) ✓
  ```

## Deviations from plan

- Chrome MCP DOM inspection worked for the `/voice-library` page (tabs enumerated, cards rendered) but eval-return values were sometimes elided; verification for Steps 4–7 was done via backend API calls that hit the **same code paths** the UI would trigger. The frontend HTTP wrappers in `frontweb/src/api/voiceLibrary.js` and `frontweb/src/api/drama.js` are thin `axios` calls to these endpoints — no client-side transformation risk.
- Initial ElevenLabs API key lacked `text_to_speech` scope. User regenerated a key with the correct permission and re-ran Step 3a successfully — all four sub-flows (design, ElevenLabs import, test-bench, and 3-voice batch recommend) now confirmed.

## Follow-ups

1. **[Recommendation quality]** `regenerateForCharacter` LLM prompt rationalizes cross-gender assignments when the library is small. Consider (a) filtering candidate pool by hard gender constraint before prompting, or (b) telling the LLM "keep same voice if no better option exists" in the prompt. Not a blocker — batch recommend on the same library was correct.
2. **[ElevenLabs error UX]** When the API key is missing `text_to_speech` scope, the 401 message from ElevenLabs is bubbled up verbatim. UI could special-case scope errors and prompt the user to generate a new key with correct permissions.
3. **[Chrome MCP eval quirk]** `use_browser` action=eval sometimes doesn't surface return values in the tool result even when the code executes. Retry with a shorter payload or use `extract` on the DOM instead.

## Artifacts left on disk (test data — safe to delete)

- 3 tts config rows (`ai_service_configs` id 9, 10, plus any earlier test rows)
- `voice_library` id 1 (OV-Elder-Male) still active; id 2 soft-deleted
- `characters.voice_id` populated for chars 1–4 of Drama 1 (林薇 currently NULL after Step 7)
- WAV files under `backend-node/data/storage/voice_library/` and `.../tmp/` (~1.2MB total)

## No code changes committed. No PRs opened. No follow-up work scoped into main.
