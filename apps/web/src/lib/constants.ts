import type { Aspect, DesignAge, DesignGender, DesignOrientation, DesignPose, DesignStyle, EngineMode, Expression, Gaze, Gesture, Language, Quality } from "./types";

export const CONSENT_SCRIPT = (name: string, date: string) =>
  `Hi, I'm ${name}. I'm recording this on ${date} and I give Avatar Studio permission to create an AI avatar of me for videos I make. I'm smiling, looking at the camera, and speaking naturally for fifteen seconds.`;

export const VOICE_SAMPLE_SCRIPT =
  "Hi, this is my voice. I make short videos to teach and to sell, and I like my words to be clear, warm and easy to follow. Every sentence should sound the way I speak on a good day: steady, friendly, and sure of itself. Thanks for listening to me for these thirty seconds.";

export const STARTER_SCRIPT = (name: string) =>
  `Hi, I'm ${name}. This is my first video made with Avatar Studio. I typed this script on my phone, picked my voice, and pressed one button. If you want short videos like this one, reply and tell me what you would say first.`;

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
];

export const ENGINES: { value: EngineMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "We pick the best engine for this avatar." },
  { value: "photo", label: "Photo", hint: "Animates a photo. Works right away." },
  { value: "real_footage", label: "Real footage", hint: "Keeps your real recording and redraws the mouth." },
  { value: "mouth_only", label: "Mouth-only", hint: "Cheapest: only the lips move." },
];

export const EXPRESSIONS: { value: Expression; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "confident", label: "Confident" },
  { value: "smile", label: "Smile" },
  { value: "serious", label: "Serious" },
  { value: "enthusiastic", label: "Enthusiastic" },
];

export const GESTURES: { value: Gesture; label: string }[] = [
  { value: "none", label: "None" },
  { value: "wave", label: "Wave" },
  { value: "point", label: "Point" },
  { value: "thumbs_up", label: "Thumbs up" },
  { value: "open_palms", label: "Open palms" },
  { value: "hand_on_heart", label: "Hand on heart" },
];

export const GAZES: { value: Gaze; label: string }[] = [
  { value: "camera", label: "Camera" },
  { value: "ahead", label: "Ahead" },
];

export const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
];

export const QUALITIES: { value: Quality; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
];

export const RENDER_STAGES = ["Voice", "Avatar", "Sharpen", "Captions"] as const;

/** Engine Lab test script: ~150 words of English with one Hinglish line, so lip sync is judged on both. */
export const LAB_TEST_SCRIPT =
  "Hi, I'm testing Avatar Studio today. This short clip checks three things: how well my lips match the words, how natural my head and hands move, and whether the person on screen still looks like me. I'll speak at a normal pace, pause once or twice, and change my tone a little, the way I would in a real Reel. Here is a quick story. Last week a student messaged me at midnight. She had tried to start a YouTube channel three times and quit three times. We talked for ten minutes about scripts, not cameras, and the next morning she posted her first video. Yaar, sach bolun toh, that one message made my whole week. If you are watching this on your phone, pause for a second and notice the eyes, the mouth and the shoulders. That is what we are scoring. Thanks for watching, and see you in the next one.";

/** Card order on Settings → Connections. Unknown services go after these. */
export const CONNECTION_ORDER = ["elevenlabs", "sarvam", "anthropic", "runpod", "fal", "r2", "clerk"] as const;

/** Engines that can be queued from the Lab (the HeyGen benchmark is an upload, handled separately). */
export const LAB_RUN_ENGINES = ["wan_s2v", "infinitetalk", "infinitetalk_v2v", "latentsync", "mock"] as const;
/** Engines that need the real clip before they can run. */
export const LAB_CLIP_ENGINES = ["infinitetalk_v2v", "latentsync"] as const;
/** Engines eligible to become the photo-mode default. */
export const LAB_PHOTO_ENGINES = ["wan_s2v", "infinitetalk"] as const;

export const SCORE_CRITERIA: { key: "lipsync" | "motion" | "identity" | "overall"; label: string; short: string }[] = [
  { key: "lipsync", label: "Lip sync", short: "Lips" },
  { key: "motion", label: "Natural motion", short: "Motion" },
  { key: "identity", label: "Looks like the person", short: "Identity" },
  { key: "overall", label: "Would you post this Reel?", short: "Overall" },
];

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Ready" },
  { value: "rendering", label: "Rendering" },
  { value: "queued", label: "Waiting" },
  { value: "draft", label: "Drafts" },
  { value: "failed", label: "Failed" },
];

/* ------------------------------------------------------------------ */
/* v2: teach my style, look generator, design with AI                   */
/* ------------------------------------------------------------------ */

/** Credits for the one-time style training; charged only when the job succeeds. */
export const TRAIN_STYLE_CREDITS = 40;
/** Footage needed for training (reference clip + uploaded clips), in seconds. */
export const MIN_FOOTAGE_SECONDS = 120;
export const MAX_FOOTAGE_SECONDS = 600;
/** Each footage recording in the sheet is at most this long. */
export const FOOTAGE_CLIP_SECONDS = 60;
export const NEW_LOOK_CREDITS = 2;
export const CAMERA_ANGLE_CREDITS = 6;
export const DESIGN_CREDITS = 2;

export const LOOK_DEFAULTS = {
  outfit: "same outfit",
  setting: "same background",
  lighting: "soft natural light",
  framing: "medium shot, facing camera",
} as const;

export const DESIGN_AGES: { value: DesignAge; label: string }[] = [
  { value: "young adult", label: "Young adult" },
  { value: "adult", label: "Adult" },
  { value: "middle-aged", label: "Middle-aged" },
  { value: "senior", label: "Senior" },
  { value: "teen", label: "Teen" },
];

export const DESIGN_GENDERS: { value: DesignGender; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "person", label: "Person" },
];

export const DESIGN_ORIENTATIONS: { value: DesignOrientation; label: string; hint: string }[] = [
  { value: "portrait", label: "Portrait", hint: "Best for Reels and Shorts (9:16)." },
  { value: "landscape", label: "Landscape", hint: "Best for YouTube (16:9)." },
  { value: "square", label: "Square", hint: "Feed posts (1:1)." },
];

export const DESIGN_POSES: { value: DesignPose; label: string }[] = [
  { value: "head and shoulders", label: "Head and shoulders" },
  { value: "upper body", label: "Upper body" },
  { value: "seated at a desk", label: "Seated at a desk" },
  { value: "standing", label: "Standing" },
];

export const DESIGN_STYLES: { value: DesignStyle; label: string }[] = [
  { value: "Realistic", label: "Realistic" },
  { value: "Pixar", label: "Pixar" },
  { value: "Cinematic", label: "Cinematic" },
  { value: "Vintage", label: "Vintage" },
  { value: "Noir", label: "Noir" },
  { value: "Cyberpunk", label: "Cyberpunk" },
];

/* ------------------------------------------------------------------ */
/* v3: translate, clips                                                 */
/* ------------------------------------------------------------------ */

/** Translation cost per minute of the source video (the API also returns it as credits_per_minute). */
export const TRANSLATE_CREDITS_PER_MINUTE = 6;
export const CLIP_MAX_COUNT = 10;
/** Length presets for the Clip sheet (seconds). */
export const CLIP_LENGTH_PRESETS: { label: string; min: number; max: number }[] = [
  { label: "5–15 s", min: 5, max: 15 },
  { label: "15–30 s", min: 15, max: 30 },
  { label: "15–60 s", min: 15, max: 60 },
  { label: "30–60 s", min: 30, max: 60 },
];
