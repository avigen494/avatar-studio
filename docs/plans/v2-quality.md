# Plan: v2 Quality (weeks 4–8)

Done when: blind test, 3 of 5 viewers cannot tell our video from HeyGen Avatar V for a 60-second Reel.

| Item (PRD section 4) | Backend | Web | Needs |
| --- | --- | --- | --- |
| Real-footage mode (V2V) | done: `infinitetalk_v2v` through the RunPod adapter, auto-picked when a clip exists | engine chip exists | RunPod endpoint |
| Teach it my style | done: footage uploads, `train_style` job, 40 credits on success, LoRA task in `apps/gpu` | done: Train my style sheet, footage list with minutes bar, live status | RunPod endpoint (H100 for 1–3 h) |
| Motion chips | done: P2 template to the GPU prompt | done | — |
| Sharpen pass 1080p/4K | done: `finish` task (Real-ESRGAN + GFPGAN + RIFE) | quality chips exist | RunPod endpoint |
| Hindi / Hinglish voices | done: Sarvam adapter | done | Sarvam key |
| Look generator | done: `generate_look` job, 3 variants 2 credits, camera angles 6 credits, look packs, Design with AI, fal or mock | done: Make with AI (prompt / packs / angles), Design with AI, candidate grid | fal key |
| Brand kit + glossary | done: colour captions, logo overlay (paid plans), glossary in speech | done: logo upload, colour, caption style, show-logo toggle, glossary table | — |
| Consent face match | done: InsightFace task, auto when RunPod is connected | consent notes already shown | RunPod endpoint |
| Monthly panel vs HeyGen | Engine Lab | done by web agent | 5 viewers |

Work order after the web pass: run Stage 0, pick the engine, train the first style file on Avinash, run the blind test.
