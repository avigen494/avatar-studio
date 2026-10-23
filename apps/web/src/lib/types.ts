// Hand-written to match apps/api/openapi.json exactly.

export type Language = "en" | "hi" | "hinglish";
export type EngineMode = "auto" | "photo" | "real_footage" | "mouth_only";
export type Quality = "720p" | "1080p" | "4k";
export type Aspect = "9:16" | "16:9" | "1:1";
export type VoiceStyle = "neutral" | "energetic" | "warm" | "serious";
export type Expression = "calm" | "confident" | "smile" | "serious" | "enthusiastic";
export type Gesture = "none" | "wave" | "point" | "thumbs_up" | "open_palms" | "hand_on_heart";
export type Gaze = "camera" | "ahead";

export type VideoStatus = "draft" | "queued" | "rendering" | "succeeded" | "failed" | "cancelled";
export type PreviewStatus = "none" | "queued" | "rendering" | "ready" | "failed";
export type IdentityStatus = "draft" | "verifying" | "ready" | "failed";
export type ConsentStatus = "missing" | "pending" | "verified" | "rejected";

export interface Motion {
  expression: Expression;
  gesture: Gesture;
  gaze: Gaze;
}

export interface UserOut {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
}

export interface GlossaryEntry {
  term: string;
  pronunciation: string;
  [k: string]: unknown;
}

export type CaptionStyle = "default" | "brand";

/** Keys the API keeps: logo_key, primary_color, caption_style, logo_position, show_logo. */
export interface BrandKit {
  primary_color?: string;
  logo_key?: string | null;
  caption_style?: CaptionStyle;
  show_logo?: boolean;
  logo_position?: string;
  [k: string]: unknown;
}

export interface WorkspaceOut {
  id: string;
  name: string;
  slug: string;
  plan: string;
  ai_label_enabled: boolean;
  watermark_enabled: boolean;
  max_avatars: number;
  brand_kit: BrandKit;
  glossary: GlossaryEntry[];
  role?: string | null;
  /** Signed URL of the uploaded logo, when there is one. */
  brand_logo_url?: string | null;
}

/** How a render's consistency was checked: InsightFace on RunPod, or the local frame proxy. */
export type QualityMethod = "face_match" | "frame_similarity";

export interface WorkspacePatch {
  name?: string | null;
  ai_label_enabled?: boolean | null;
  brand_kit?: BrandKit | null;
  glossary?: GlossaryEntry[] | null;
}

export interface MemberOut {
  user: UserOut;
  role: string;
}

export interface Onboarding {
  has_avatar: boolean;
  avatar_ready: boolean;
  has_voice: boolean;
  has_video: boolean;
  has_finished_video: boolean;
  complete: boolean;
}

export interface MeOut {
  user: UserOut;
  workspace: WorkspaceOut;
  workspaces: WorkspaceOut[];
  credits: number;
  onboarding: Onboarding;
}

export type PresignPurpose = "reference" | "consent" | "look" | "voice_sample" | "brand" | "footage";

export interface PresignIn {
  purpose: PresignPurpose;
  filename: string;
  content_type: string;
  identity_id?: string | null;
  size_bytes?: number | null;
}

export interface PresignOut {
  key: string;
  method: string;
  url: string;
  headers: Record<string, string>;
}

export type LookKind = "photo" | "video" | "generated";

export interface LookOut {
  id: string;
  identity_id: string;
  name: string;
  kind: LookKind | string;
  is_default: boolean;
  media_url?: string | null;
  thumbnail_url?: string | null;
  created_at: string;
}

export interface LookCreate {
  key: string;
  name?: string;
  kind?: "photo" | "video";
}

export type StyleStatus = "none" | "queued" | "training" | "ready" | "failed";

export interface IdentityOut {
  id: string;
  name: string;
  kind: "real_person" | "designed" | string;
  status: IdentityStatus | string;
  consent_status: ConsentStatus | string;
  consent_method?: string | null;
  consent_notes?: string | null;
  style_status: StyleStatus | string;
  style_error?: string | null;
  style_trained_at?: string | null;
  /** Seconds of footage the ready style was trained on. */
  style_footage_seconds?: number | null;
  /** Training clips added with POST /identities/{id}/footage. */
  footage_count: number;
  footage: FootageOut[];
  /** Reference seconds + measured clip seconds; null when there is no footage at all. */
  footage_seconds_total?: number | null;
  reference_duration_s?: number | null;
  reference_url?: string | null;
  thumbnail_url?: string | null;
  can_render: boolean;
  /** v3: who may make videos with this avatar. Empty = every editor in the workspace. */
  allowed_user_ids?: string[];
  /** Every render of this avatar starts from this seed so videos look consistent. */
  render_seed?: number | null;
  looks: LookOut[];
  created_at: string;
}

export interface IdentityCreate {
  name: string;
  kind?: "real_person" | "designed";
  design?: Record<string, unknown>;
}

export interface ReferenceIn {
  key: string;
  consent_key?: string | null;
  consent_text_read?: boolean;
}

/* v2: footage, teach-my-style, look generator, design with AI */

export interface FootageIn {
  key: string;
}

export interface FootageOut {
  key: string;
  url?: string | null;
  /** Measured by the API; null while it could not be read. */
  seconds?: number | null;
}

/** 202 from train-style, looks/generate and design. */
export interface JobStartOut {
  job_id: string;
  credits: number;
  message: string;
}

export type IdentityJobType = "train_style" | "generate_look";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** IdentityJobOut */
export interface IdentityJob {
  id: string;
  type: IdentityJobType | string;
  status: JobStatus | string;
  stage: string;
  progress: number;
  error: string | null;
  created_at: string;
  result: Record<string, unknown>;
}

export type LookGenerateMode = "look" | "camera_angles";

export interface LookGenerateIn {
  mode: LookGenerateMode;
  name?: string | null;
  outfit?: string;
  setting?: string;
  lighting?: string;
  framing?: string;
  source_look_id?: string | null;
  pack_id?: string | null;
  pack_index?: number | null;
}

export interface LookPackEntry {
  name: string;
  outfit: string;
  setting: string;
  lighting: string;
  framing: string;
}

export interface LookPackOut {
  id: string;
  name: string;
  niche: string;
  looks: LookPackEntry[];
}

export type DesignAge = "young adult" | "adult" | "middle-aged" | "senior" | "teen";
export type DesignGender = "woman" | "man" | "person";
export type DesignOrientation = "portrait" | "landscape" | "square";
export type DesignPose = "head and shoulders" | "upper body" | "seated at a desk" | "standing";
export type DesignStyle = "Realistic" | "Pixar" | "Cinematic" | "Vintage" | "Noir" | "Cyberpunk";

export interface DesignIn {
  age: DesignAge;
  gender: DesignGender;
  ethnicity: string;
  description: string;
  orientation: DesignOrientation;
  pose: DesignPose;
  style: DesignStyle;
}

export interface VoiceOut {
  id: string;
  name: string;
  engine: string;
  source: string;
  language: string;
  gender?: string | null;
  style?: string | null;
  is_default: boolean;
  status: string;
  external_voice_id?: string | null;
  sample_url?: string | null;
  supports_delivery_tags: boolean;
  has_byo_key?: boolean;
}

export interface LibraryVoiceOut {
  engine: string;
  external_voice_id: string;
  name: string;
  language: string;
  gender?: string | null;
  style?: string | null;
}

export interface VoiceAdopt {
  engine: string;
  external_voice_id: string;
  name: string;
  language?: Language;
  gender?: string | null;
  style?: string | null;
}

export interface VoiceClone {
  name: string;
  sample_key: string;
  language?: Language;
}

export interface VoicePatch {
  name?: string | null;
  is_default?: boolean | null;
  language?: Language | null;
}

export interface ProjectOut {
  id: string;
  name: string;
  created_at: string;
  video_count: number;
  credits_used: number;
}

export interface GuardrailOut {
  category: string;
  excerpt: string;
  message: string;
}

export interface EstimateIn {
  script: string;
  language?: Language;
  engine_mode?: EngineMode;
  quality?: Quality;
  identity_id?: string | null;
}

export interface EstimateOut {
  seconds: number;
  minutes: number;
  credits: number;
  engine: string;
  quality: string;
  inr: number;
  words: number;
  breakdown: Record<string, unknown>;
  balance: number;
  can_afford: boolean;
  guardrails: GuardrailOut[];
  blockers: string[];
}

export interface VideoCreate {
  identity_id: string;
  voice_id: string;
  script: string;
  title?: string | null;
  look_id?: string | null;
  project_id?: string | null;
  language?: Language;
  engine_mode?: EngineMode;
  motion?: Motion;
  aspect?: Aspect;
  quality?: Quality;
  captions?: boolean;
  voice_style?: VoiceStyle;
}

export interface VideoPatch {
  title?: string | null;
  script?: string | null;
  project_id?: string | null;
  look_id?: string | null;
  voice_id?: string | null;
  language?: Language | null;
  engine_mode?: EngineMode | null;
  motion?: Motion | null;
  aspect?: Aspect | null;
  quality?: Quality | null;
  captions?: boolean | null;
  voice_style?: VoiceStyle | null;
}

export type VideoKind = "video" | "translation" | "clip";

export interface VideoOut {
  id: string;
  project_id: string | null;
  identity_id: string;
  look_id: string | null;
  voice_id: string;
  title: string;
  script: string;
  language: string;
  engine_mode: string;
  resolved_engine: string | null;
  motion: Partial<Motion> & Record<string, unknown>;
  aspect: string;
  quality: string;
  captions: boolean;
  voice_style: string;
  estimated_seconds: number;
  estimated_credits: number;
  charged_credits: number;
  status: VideoStatus | string;
  stage: string;
  progress: number;
  eta_seconds: number | null;
  error_message: string | null;
  duration_s: number | null;
  transcript: string | null;
  summary: string | null;
  watermarked: boolean;
  ai_labelled: boolean;
  preview_status: PreviewStatus | string;
  /** v3: "video" (default), "translation" or "clip". */
  kind?: VideoKind | string;
  /** v3: the video a translation or clip was made from. */
  source_video_id?: string | null;
  preview_progress?: number;
  /** Consistency check (quality gate): 0–1 similarity to the reference, and how it was measured. */
  quality_score?: number | null;
  quality_method?: QualityMethod | string | null;
  /** Seed the render started from (pinned per avatar) and how many attempts the gate needed. */
  render_seed?: number | null;
  render_attempts?: number;
  /** GPU image tag the render used. */
  engine_version?: string | null;
  reactions?: Record<string, number>;
  share_enabled: boolean;
  share_token: string | null;
  share_has_password?: boolean;
  views: number;
  output_url?: string | null;
  output_captioned_url?: string | null;
  srt_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  share_url?: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VideoList {
  items: VideoOut[];
  next_cursor?: string | null;
}

export interface ShareIn {
  enabled?: boolean;
  password?: string | null;
}

export interface ShareMeta {
  title: string;
  creator: string;
  needs_password: boolean;
  ai_labelled: boolean;
  watermarked: boolean;
  summary?: string | null;
}

export interface ShareView {
  title: string;
  creator: string;
  summary: string | null;
  transcript: string | null;
  duration_s: number | null;
  aspect: string;
  video_url: string;
  captioned_url: string | null;
  thumbnail_url: string | null;
  views: number;
  reactions: Record<string, number>;
  ai_labelled: boolean;
  watermarked: boolean;
}

export type ReactionEmoji = "❤️" | "🔥" | "👏" | "😂" | "🤯" | "👍";
export const REACTIONS: ReactionEmoji[] = ["❤️", "🔥", "👏", "😂", "🤯", "👍"];

export interface CreditsOut {
  balance: number;
  plan: string;
  price_per_credit_inr: number;
  free_preview_seconds: number;
}

export interface LedgerEntryOut {
  id: string;
  kind: string;
  amount: number;
  note: string;
  video_id: string | null;
  job_id: string | null;
  created_at: string;
}

export interface ScriptHelpIn {
  brief: string;
  audience?: string;
  language?: Language;
  target_seconds?: number;
}

export interface ScriptHelpOut {
  script: string;
  words: number;
  seconds: number;
  model: string;
  guardrails: GuardrailOut[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Runtime config, admin connections, engine lab                        */
/* ------------------------------------------------------------------ */

export type AuthMode = "dev" | "clerk";

export interface PublicConfig {
  auth_mode: AuthMode;
  clerk_publishable_key: string;
  api_base_url: string;
  avatar_engine: string;
  voice_engines: string[];
  script_helper: boolean;
  look_generator: boolean;
}

export interface WhoamiOut {
  is_admin: boolean;
}

export type FieldSource = "db" | "env" | "default" | "none" | string;

export interface ConnectionField {
  key: string;
  label: string;
  help: string;
  placeholder: string;
  secret: boolean;
  choices: string[] | null;
  /** Full value for plain fields, masked ("sk_…abcd") for secrets. */
  value: string | null;
  is_set: boolean;
  source: FieldSource;
}

export interface ConnectionOut {
  id: string;
  name: string;
  purpose: string;
  docs_url: string;
  required_for: string;
  warning?: string | null;
  fields: ConnectionField[];
  connected: boolean;
  last_test_ok?: boolean | null;
  last_test_message?: string | null;
  last_tested_at?: string | null;
}

export interface ConnectionSaveIn {
  values: Record<string, string | null>;
}

export interface ConnectionTestOut {
  ok: boolean;
  message: string;
}

export type LabEngineId = "wan_s2v" | "infinitetalk" | "infinitetalk_v2v" | "latentsync" | "mock" | "heygen_v";
export type LabRunsOn = "local" | "runpod" | "upload";
export type TrialStatus = "queued" | "running" | "succeeded" | "failed";

export interface LabEngine {
  id: LabEngineId | string;
  label: string;
  runs_on: LabRunsOn;
}

export interface LabEnginesOut {
  engines: LabEngine[];
  backend: string;
  gpu: string;
  gpu_price_inr_per_hour: number;
  note?: string | null;
}

export interface TrialIn {
  name: string;
  engine: string;
  script?: string;
  voice_id?: string | null;
  look_key?: string | null;
  reference_key?: string | null;
  aspect?: Aspect | string;
  steps?: number;
  notes?: string;
  benchmark_key?: string | null;
}

export interface ScoreIn {
  rater: string;
  lipsync: number;
  motion: number;
  identity: number;
  overall: number;
  guessed_heygen?: boolean;
}

export interface TrialScore extends ScoreIn {
  [k: string]: unknown;
}

export type TrialAverages = Partial<Record<"lipsync" | "motion" | "identity" | "overall" | "panel", number | null>>;

export interface TrialOut {
  id: string;
  name: string;
  engine: string;
  engine_label: string;
  gpu: string;
  status: TrialStatus | string;
  script: string;
  voice_id: string | null;
  aspect: string;
  steps: number;
  output_url: string | null;
  thumbnail_url: string | null;
  look_url: string | null;
  reference_url: string | null;
  duration_s: number | null;
  wall_seconds: number | null;
  gpu_seconds: number | null;
  cost_inr: number | null;
  cost_per_minute_inr: number | null;
  vram_gb: number | null;
  error: string | null;
  notes: string;
  is_benchmark: boolean;
  /** Golden set: a regression baseline. A rerun carries golden_of = the baseline's id. */
  is_golden: boolean;
  golden_of: string | null;
  quality_score: number | null;
  quality_method: QualityMethod | string | null;
  seed: number | null;
  engine_version: string | null;
  scores: TrialScore[];
  averages: TrialAverages;
  created_at: string;
}

export interface GoldenIn {
  is_golden: boolean;
}

export type GoldenVerdict = "ok" | "not rerun yet" | "worse: quality dropped" | "worse: much slower";

/** One row of GET /lab/golden: the baseline and its latest successful rerun. */
export interface GoldenRow {
  golden: TrialOut;
  latest: TrialOut | null;
  pending_reruns: number;
  quality_delta: number | null;
  wall_delta_s: number | null;
  cost_per_minute: { golden: number | null; latest: number | null };
  verdict: GoldenVerdict | string;
}

export interface GoldenReportOut {
  rows: GoldenRow[];
  count: number;
  regressions: number;
}

export interface SummaryRow {
  engine: string;
  engine_label: string;
  trials: number;
  scored: number;
  avg: Partial<Record<"lipsync" | "motion" | "identity" | "overall", number | null>>;
  panel_avg: number | null;
  cost_per_minute_inr: number | null;
  wall_seconds_per_minute: number | null;
  guessed_heygen: number;
  verdict: string;
}

export interface SummaryOut {
  rows: SummaryRow[];
  recommended_photo_engine: string | null;
  current_default: string;
  gpu: string;
  gpu_price_inr_per_hour: number;
}

/* ------------------------------------------------------------------ */
/* v3: billing, teams, developers, batch                                */
/* ------------------------------------------------------------------ */

export type Currency = "INR" | "USD";
export type PlanId = "free" | "creator" | "pro" | "team";

/** One entry of GET /billing → plans. Amounts in paise (INR) / cents (USD). */
export interface PlanOut {
  id: PlanId | string;
  name: string;
  inr_month: number;
  inr_year_month: number | null;
  usd_month: number;
  credits_month: number;
  minutes_estimate: string;
  max_avatars: number;
  max_members: number;
  watermark: boolean;
  max_quality: string;
  includes: string[];
  rollover_months: number | null;
  seat_inr_month: number;
  seat_usd_month: number;
  current: boolean;
}

export interface SubscriptionOut {
  id: string;
  provider: string;
  plan: string;
  currency: string;
  yearly: boolean;
  seats: number;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface PaymentOut {
  id: string;
  provider: string;
  kind: string;
  plan: string | null;
  amount: number;
  currency: string;
  net_amount: number;
  tax_amount: number;
  credits: number;
  status: string;
  invoice_number: string | null;
  paid_at: string | null;
  description: string;
  created_at: string;
  /** v3: signed link to the printable invoice; opens without auth headers. */
  invoice_url?: string | null;
}

export interface TopupOut {
  credits: number;
  inr: number;
  usd: number;
  available: boolean;
}

export interface ProvidersOut {
  razorpay: boolean;
  stripe: boolean;
  mock: boolean;
  razorpay_key_id: string | null;
}

export interface BillingOut {
  plan: string;
  plan_name: string;
  credits: number;
  subscription: SubscriptionOut | null;
  payments: PaymentOut[];
  plans: PlanOut[];
  topup: TopupOut;
  providers: ProvidersOut;
  seats_included: number;
  seats_extra: number;
  price_change_notice: string | null;
  /** v3: when a cancelled plan runs out (the subscription stays in `subscription` until then). */
  plan_ends_at?: string | null;
}

export type CheckoutKind = "plan" | "topup" | "seats";

export interface CheckoutIn {
  kind: CheckoutKind;
  plan?: string | null;
  currency?: Currency;
  yearly?: boolean;
  seats?: number;
  buyer_name?: string | null;
  gstin?: string | null;
  address?: string | null;
}

export type CheckoutMode = "razorpay_checkout" | "redirect" | "mock";

/** POST /billing/checkout for kind plan/topup. (kind "seats" answers {ok, seats}.) */
export interface CheckoutOut {
  provider: string;
  kind: CheckoutKind;
  mode: CheckoutMode;
  provider_order_id: string | null;
  provider_subscription_id: string | null;
  redirect_url: string | null;
  public_key: string | null;
  amount: number | null;
  currency: string | null;
  extra: Record<string, unknown> | null;
  prefill: { name: string | null; email: string | null };
}

export interface SeatsCheckoutOut {
  ok: boolean;
  seats: number;
}

export interface ConfirmIn {
  provider: string;
  payload: Record<string, unknown>;
}

export interface ConfirmOut {
  ok: boolean;
  note?: string;
  [k: string]: unknown;
}

export interface CancelOut {
  ok: boolean;
  message: string;
}

/** POST /billing/resume. 409 cannot_resume when there is nothing to keep. */
export interface ResumeOut {
  ok: boolean;
  message?: string;
  [k: string]: unknown;
}

/* Teams */

export type Role = "owner" | "admin" | "editor" | "viewer";
export type InviteRole = Exclude<Role, "owner">;

export interface SeatsOut {
  members: number;
  pending_invites: number;
  limit: number;
  plan: string;
}

export interface InviteIn {
  email: string;
  role?: InviteRole;
}

export interface InviteOut {
  id: string;
  email: string;
  role: string;
  link: string;
  expires_at: string;
  /** v3: computed by the API; use it instead of comparing dates. */
  expired?: boolean;
  accepted_at: string | null;
  invited_by: string | null;
}

export interface InviteMeta {
  workspace: string;
  role: string;
  invited_by: string | null;
  email: string;
  expired: boolean;
  accepted: boolean;
}

export interface RolePatch {
  role: Role;
}

export interface RoleOut {
  user_id: string;
  role: string;
}

export interface AccessIn {
  user_ids: string[];
}

export interface WorkspaceCreate {
  name: string;
}

/* Developers */

export type ApiScope = "read" | "write";

export interface ApiKeyCreate {
  name: string;
  scopes?: ApiScope[];
}

export interface ApiKeyOut {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** The full key, present only in the POST /api-keys answer. */
  key?: string | null;
}

export interface WebhookEventsOut {
  events: string[];
  signature_header: string;
  how_to_verify: string;
}

export interface WebhookIn {
  url: string;
  events?: string[];
  description?: string;
  active?: boolean;
}

export interface WebhookOut {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string;
  secret: string;
  created_at: string;
}

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface DeliveryOut {
  id: string;
  event: string;
  status: DeliveryStatus | string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
}

/* Batch */

export interface BatchCsvIn {
  file: File;
  identity_id?: string | null;
  voice_id?: string | null;
  project_id?: string | null;
  generate?: boolean;
  language?: Language;
  aspect?: Aspect;
  quality?: Quality;
}

export interface BatchRowOut {
  index: number;
  video_id: string | null;
  status: string;
  error?: string | null;
  estimated_credits: number;
}

export interface BatchOut {
  created: number;
  queued: number;
  failed: number;
  total_credits: number;
  balance_after: number;
  rows: BatchRowOut[];
}

/* ------------------------------------------------------------------ */
/* v3: translate, clips, video agent, notifications, admin usage        */
/* ------------------------------------------------------------------ */

export interface TranslateLanguage {
  code: string;
  name: string;
  indian: boolean;
}

export type TranslateMode = "audio_only" | "lip_sync";

export interface TranslateIn {
  languages: string[];
  mode?: TranslateMode;
  /** Default: the source video's voice. */
  voice_id?: string | null;
  generate?: boolean;
}

/** 202. Errors: 400 same_language / bad_language, 402 insufficient_credits (drafts kept), 422 blocked, 503 assistant_unavailable. */
export interface TranslateOut {
  videos: VideoOut[];
  credits_per_minute: number;
  note: string;
}

export interface ClipIn {
  count?: number;
  min_seconds?: number;
  max_seconds?: number;
}

/** 202. 409 not_ready before the source has rendered, 402 insufficient_credits. */
export interface ClipStartOut {
  job_id: string;
  credits: number;
  message: string;
}

/** GET /jobs/{id}/status */
export interface JobStatusOut {
  status: JobStatus | string;
  stage: string;
  progress: number;
  error: string | null;
  result?: { clip_ids?: string[]; [k: string]: unknown } | null;
  [k: string]: unknown;
}

export interface PlanIn {
  brief: string;
  target_seconds?: number;
  identity_id?: string | null;
  voice_id?: string | null;
}

export type SceneType = "A" | "B";

export interface PlanScene {
  name: string;
  start_s: number;
  end_s: number;
  type: SceneType | string;
  visual: string;
  voiceover: string;
}

export interface VideoPlan {
  title: string;
  /** "9:16" | "16:9" | "1:1", or portrait / landscape / square. */
  orientation: string;
  language: string;
  scenes: PlanScene[];
}

/** POST /ai/plan (the API calls it PlanOut; renamed here to keep clear of the billing PlanOut). 503 assistant_unavailable. */
export interface VideoPlanOut {
  plan: VideoPlan;
  script: string;
  seconds: number;
  model: string;
}

export interface NotifyPrefs {
  /** E.164, like +919876543210. */
  phone: string | null;
  notify_whatsapp: boolean;
}

export interface UsageVideos {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  minutes: number;
  credits_charged: number;
  failure_rate: number;
}

export interface UsageCost {
  p50: number | null;
  p95: number | null;
  target_p95: number;
  samples: number;
  gpu_price_inr_per_hour: number;
  note?: string | null;
}

export interface UsageWorkspaces {
  total: number;
  paying: number;
  by_plan: Record<string, number>;
  target_paying: number;
}

export interface UsageWorkspaceRow {
  id: string;
  name: string;
  plan: string;
  videos: number;
  succeeded: number;
  failed: number;
  minutes: number;
  credits_charged: number;
  members: number;
  balance: number;
}

export interface UsageDay {
  date: string;
  videos: number;
  succeeded: number;
}

/** GET /admin/usage?days=N. Revenue is in paise (INR) / cents (USD). */
export interface AdminUsageOut {
  days: number;
  videos: UsageVideos;
  cost_per_minute_inr: UsageCost;
  revenue: Partial<Record<Currency | string, number>>;
  workspaces: UsageWorkspaces;
  per_workspace: UsageWorkspaceRow[];
  daily: UsageDay[];
  engine_trials: number;
}
