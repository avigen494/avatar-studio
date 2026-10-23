"""
Look packs (PRD section 13): preset outfit + setting combinations for Indian
niches, used by the look generator. Each pack yields 3 variants for 2 credits
like any prompt. Adding a pack is adding a dict here.
"""
from __future__ import annotations

PACKS: list[dict] = [
    {"id": "coaching", "name": "Coaching & courses", "niche": "Educators",
     "looks": [
         {"name": "Studio teacher", "outfit": "smart navy kurta with a light shawl", "setting": "clean studio with a soft bookshelf backdrop", "lighting": "soft key light", "framing": "medium shot, facing camera"},
         {"name": "Whiteboard", "outfit": "plain white shirt, sleeves rolled", "setting": "classroom with a whiteboard behind", "lighting": "bright even light", "framing": "medium shot, facing camera"},
         {"name": "Evening live", "outfit": "charcoal blazer over a t-shirt", "setting": "home office with warm lamps", "lighting": "warm evening light", "framing": "medium close-up, facing camera"},
     ]},
    {"id": "ca_finance", "name": "CA / accounting / finance", "niche": "Finance professionals",
     "looks": [
         {"name": "Office formal", "outfit": "dark formal suit with a plain tie", "setting": "modern glass office", "lighting": "neutral daylight", "framing": "medium shot, facing camera"},
         {"name": "Advisory desk", "outfit": "light blue formal shirt", "setting": "tidy desk with a laptop and files", "lighting": "soft window light", "framing": "medium close-up, facing camera"},
         {"name": "Boardroom", "outfit": "grey blazer and white shirt", "setting": "boardroom with a city view", "lighting": "cool daylight", "framing": "medium shot, slight left angle"},
     ]},
    {"id": "clinic", "name": "Doctor / clinic", "niche": "Healthcare",
     "looks": [
         {"name": "White coat", "outfit": "white doctor coat over formal wear, stethoscope", "setting": "bright clinic consultation room", "lighting": "clean bright light", "framing": "medium shot, facing camera"},
         {"name": "Reception", "outfit": "pastel formal kurta", "setting": "clinic reception with plants", "lighting": "soft daylight", "framing": "medium shot, facing camera"},
         {"name": "Home advice", "outfit": "casual shirt", "setting": "calm living room", "lighting": "warm natural light", "framing": "medium close-up, facing camera"},
     ]},
    {"id": "real_estate", "name": "Real estate", "niche": "Property",
     "looks": [
         {"name": "Site visit", "outfit": "crisp white shirt and dark trousers", "setting": "sunlit apartment balcony with a city skyline", "lighting": "golden hour", "framing": "medium shot, facing camera"},
         {"name": "Sample flat", "outfit": "fitted blazer", "setting": "furnished model apartment living room", "lighting": "bright interior light", "framing": "medium shot, slight right angle"},
         {"name": "Office", "outfit": "formal shirt with a lanyard", "setting": "property office with floor plans on the wall", "lighting": "neutral light", "framing": "medium close-up, facing camera"},
     ]},
    {"id": "retail", "name": "Kirana / retail / D2C", "niche": "Shops and brands",
     "looks": [
         {"name": "Shop floor", "outfit": "branded polo shirt", "setting": "neatly stocked shop shelves", "lighting": "bright shop light", "framing": "medium shot, facing camera"},
         {"name": "Product table", "outfit": "casual shirt with an apron", "setting": "wooden table with products in soft focus", "lighting": "soft daylight", "framing": "medium close-up, facing camera"},
         {"name": "Festive sale", "outfit": "festive kurta", "setting": "shop decorated with marigold garlands and fairy lights", "lighting": "warm festive light", "framing": "medium shot, facing camera"},
     ]},
    {"id": "wedding", "name": "Wedding & events", "niche": "Planners and creators",
     "looks": [
         {"name": "Sangeet", "outfit": "embroidered sherwani or lehenga in jewel tones", "setting": "decorated wedding stage with flowers", "lighting": "warm stage light", "framing": "medium shot, facing camera"},
         {"name": "Day event", "outfit": "pastel ethnic wear", "setting": "garden venue with white drapes", "lighting": "soft daylight", "framing": "medium shot, slight left angle"},
         {"name": "Planner", "outfit": "smart black outfit with a headset", "setting": "banquet hall being set up", "lighting": "neutral light", "framing": "medium close-up, facing camera"},
     ]},
    {"id": "creator", "name": "Creator / UGC", "niche": "Social creators",
     "looks": [
         {"name": "Reels corner", "outfit": "oversized hoodie", "setting": "bedroom corner with LED strip lights", "lighting": "pink and blue accent light", "framing": "close-up, facing camera"},
         {"name": "Cafe", "outfit": "denim jacket over a white tee", "setting": "busy cafe with a blurred background", "lighting": "window light", "framing": "medium close-up, facing camera"},
         {"name": "Podcast", "outfit": "plain black t-shirt", "setting": "podcast desk with a microphone", "lighting": "dramatic single key light", "framing": "medium shot, slight right angle"},
     ]},
]

PACK_BY_ID = {p["id"]: p for p in PACKS}
