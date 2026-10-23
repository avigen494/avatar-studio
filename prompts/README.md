# Prompts

Every AI step reads its prompt from this folder (`<name>.v<N>.md`). Code fills the `{{variables}}` and nothing else (see `apps/api/app/services/prompts.py`).

| File | Step | Model | Used by |
| --- | --- | --- | --- |
| script_helper.v1.md | P1 Script helper | Claude Sonnet | POST /ai/script |
| motion.v1.md | P2 Motion prompt builder | none (template) | worker step 4 |
| delivery.v1.md | P3 Voice delivery tags | Claude Haiku | worker step 3, tag-aware engines only |
| translate.v1.md | P4 Translation with glossary | Claude Sonnet | Translate (v3) |
| planner.v1.md | P5 Video planner | Claude Sonnet, JSON | Video Agent (v3) |
| look.v1.md | P6 Look prompt builder | none (template) | Look generator (v2) |
| summary.v1.md | P7 Share-page summary | Claude Haiku | worker step 8 |
| design.v1.md | P8 Design-with-AI avatar prompt (added in v2) | none (template to the image model) | Designed avatars |
| clipping.v1.md | P9 Clip picker (added in v3) | Claude Sonnet, JSON | AI Clipping |

Changing a prompt means a new file with the version bumped (`script_helper.v2.md`) plus a before/after sample in the pull request. Never edit a prompt inline in code.
