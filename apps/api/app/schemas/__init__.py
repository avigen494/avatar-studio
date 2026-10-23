"""Pydantic request and response bodies. Plain names, plain English docs."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Language = Literal["en", "hi", "hinglish"]
EngineMode = Literal["auto", "photo", "real_footage", "mouth_only"]
Aspect = Literal["9:16", "16:9", "1:1"]
Quality = Literal["720p", "1080p", "4k"]
VoiceStyle = Literal["neutral", "energetic", "warm", "serious"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Me / workspace -----------------------------------------------------------
class WorkspaceOut(Out):
    id: str
    name: str
    slug: str
    plan: str
    ai_label_enabled: bool
    watermark_enabled: bool
    max_avatars: int
    brand_kit: dict
    glossary: list
    role: str | None = None
    brand_logo_url: str | None = None


class UserOut(Out):
    id: str
    email: str
    name: str
    avatar_url: str | None = None


class MeOut(BaseModel):
    user: UserOut
    workspace: WorkspaceOut
    workspaces: list[WorkspaceOut]
    credits: int
    onboarding: dict


class WorkspacePatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    ai_label_enabled: bool | None = None
    brand_kit: dict | None = None
    glossary: list[dict] | None = None


class MemberOut(BaseModel):
    user: UserOut
    role: str


# --- Uploads ------------------------------------------------------------------
UploadPurpose = Literal["reference", "consent", "look", "voice_sample", "brand", "footage"]


class PresignIn(BaseModel):
    purpose: UploadPurpose
    filename: str = Field(max_length=200)
    content_type: str = Field(max_length=100)
    identity_id: str | None = None
    size_bytes: int | None = Field(default=None, ge=0, le=10 * 1024 * 1024 * 1024)


class PresignOut(BaseModel):
    key: str
    method: str
    url: str
    headers: dict[str, str]


# --- Identities ---------------------------------------------------------------
class LookOut(Out):
    id: str
    identity_id: str
    name: str
    kind: str
    is_default: bool
    media_url: str | None = None
    thumbnail_url: str | None = None
    created_at: datetime


class IdentityOut(Out):
    id: str
    name: str
    kind: str
    status: str
    consent_status: str
    consent_method: str | None = None
    consent_notes: str | None = None
    style_status: str
    style_error: str | None = None
    style_trained_at: datetime | None = None
    style_footage_seconds: float | None = None
    footage_count: int = 0
    footage_seconds_total: float | None = None
    footage: list["FootageOut"] = []
    reference_duration_s: float | None = None
    reference_url: str | None = None
    thumbnail_url: str | None = None
    can_render: bool
    render_seed: int | None = None
    allowed_user_ids: list[str] = []
    looks: list[LookOut] = []
    created_at: datetime


class IdentityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["real_person", "designed"] = "real_person"
    design: dict = Field(default_factory=dict)


class IdentityPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


class ReferenceIn(BaseModel):
    key: str
    consent_key: str | None = None
    consent_text_read: bool = True


class LookCreate(BaseModel):
    key: str
    name: str = Field(default="Default", max_length=120)
    kind: Literal["photo", "video"] = "photo"


class LookPatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class LookGenerateIn(BaseModel):
    """New look from a prompt (3 variants, 2 credits), a look pack entry, or camera angles (3 angles, 6 credits)."""
    mode: Literal["look", "camera_angles"] = "look"
    pack_id: str | None = None
    pack_index: int | None = Field(default=None, ge=0, le=10)
    name: str | None = Field(default=None, max_length=100)
    outfit: str = Field(default="same outfit", max_length=200)
    setting: str = Field(default="same background", max_length=200)
    lighting: str = Field(default="soft natural light", max_length=120)
    framing: str = Field(default="medium shot, facing camera", max_length=120)
    source_look_id: str | None = None


class FootageIn(BaseModel):
    key: str


class FootageOut(BaseModel):
    key: str
    url: str | None = None
    seconds: float | None = None


class IdentityJobOut(BaseModel):
    id: str
    type: str
    status: str
    stage: str
    progress: int
    error: str | None
    created_at: datetime
    result: dict


class DesignIn(BaseModel):
    """Design with AI (PRD section 13). 3 candidates for 2 credits; pick one as the first look."""
    age: Literal["young adult", "adult", "middle-aged", "senior", "teen"] = "adult"
    gender: Literal["woman", "man", "person"] = "person"
    ethnicity: str = Field(default="Indian", max_length=60)
    description: str = Field(default="", max_length=300)
    orientation: Literal["portrait", "landscape", "square"] = "portrait"
    pose: Literal["head and shoulders", "upper body", "seated at a desk", "standing"] = "upper body"
    style: Literal["Realistic", "Pixar", "Cinematic", "Vintage", "Noir", "Cyberpunk"] = "Realistic"


class LookPackOut(BaseModel):
    id: str
    name: str
    niche: str
    looks: list[dict]


class JobStartOut(BaseModel):
    job_id: str
    credits: int
    message: str


# --- Voices -------------------------------------------------------------------
class VoiceOut(Out):
    id: str
    name: str
    engine: str
    source: str
    language: str
    gender: str | None = None
    style: str | None = None
    is_default: bool
    status: str
    external_voice_id: str | None = None
    sample_url: str | None = None
    supports_delivery_tags: bool
    has_byo_key: bool = False


class LibraryVoiceOut(BaseModel):
    engine: str
    external_voice_id: str
    name: str
    language: str
    gender: str | None = None
    style: str | None = None


class VoiceAdopt(BaseModel):
    engine: str
    external_voice_id: str
    name: str = Field(max_length=120)
    language: Language = "en"
    gender: str | None = None
    style: str | None = None


class VoiceClone(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sample_key: str
    language: Language = "en"


class VoiceImportKey(BaseModel):
    api_key: str = Field(min_length=10, max_length=200)


class VoicePatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_default: bool | None = None
    language: Language | None = None


class VoicePreviewIn(BaseModel):
    text: str | None = Field(default=None, max_length=300)
    language: Language | None = None


# --- Projects -----------------------------------------------------------------
class ProjectOut(Out):
    id: str
    name: str
    created_at: datetime
    video_count: int = 0
    credits_used: int = 0


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


# --- Videos -------------------------------------------------------------------
class Motion(BaseModel):
    expression: Literal["calm", "confident", "smile", "serious", "enthusiastic"] = "calm"
    gesture: Literal["none", "wave", "point", "thumbs_up", "open_palms", "hand_on_heart"] = "none"
    gaze: Literal["camera", "ahead"] = "camera"


class EstimateIn(BaseModel):
    script: str = Field(max_length=20000)
    language: Language = "en"
    engine_mode: EngineMode = "auto"
    quality: Quality = "720p"
    identity_id: str | None = None


class GuardrailOut(BaseModel):
    category: str
    excerpt: str
    message: str


class EstimateOut(BaseModel):
    seconds: int
    minutes: float
    credits: int
    engine: str
    quality: str
    inr: int
    words: int
    breakdown: dict
    balance: int
    can_afford: bool
    guardrails: list[GuardrailOut] = []
    blockers: list[str] = []


class VideoCreate(BaseModel):
    identity_id: str
    voice_id: str
    script: str = Field(min_length=1, max_length=20000)
    title: str | None = Field(default=None, max_length=200)
    look_id: str | None = None
    project_id: str | None = None
    language: Language = "en"
    engine_mode: EngineMode = "auto"
    motion: Motion = Field(default_factory=Motion)
    aspect: Aspect = "9:16"
    quality: Quality = "720p"
    captions: bool = True
    voice_style: VoiceStyle = "neutral"


class BatchItem(VideoCreate):
    identity_id: str | None = None  # falls back to the batch default
    voice_id: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=120)


class BatchIn(BaseModel):
    """Up to 100 videos in one call. Credits are checked for the whole batch before anything is queued."""
    items: list[BatchItem] = Field(min_length=1, max_length=100)
    identity_id: str | None = None
    voice_id: str | None = None
    project_id: str | None = None
    generate: bool = True


class BatchRowOut(BaseModel):
    index: int
    video_id: str | None
    status: str
    error: str | None = None
    estimated_credits: int = 0


class BatchOut(BaseModel):
    created: int
    queued: int
    failed: int
    total_credits: int
    balance_after: int
    rows: list[BatchRowOut]


class VideoPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    script: str | None = Field(default=None, min_length=1, max_length=20000)
    project_id: str | None = None
    look_id: str | None = None
    voice_id: str | None = None
    language: Language | None = None
    engine_mode: EngineMode | None = None
    motion: Motion | None = None
    aspect: Aspect | None = None
    quality: Quality | None = None
    captions: bool | None = None
    voice_style: VoiceStyle | None = None


class VideoOut(Out):
    id: str
    project_id: str | None
    identity_id: str
    look_id: str | None
    voice_id: str
    title: str
    script: str
    language: str
    engine_mode: str
    resolved_engine: str | None
    motion: dict
    aspect: str
    quality: str
    captions: bool
    voice_style: str
    estimated_seconds: int
    estimated_credits: int
    charged_credits: int
    status: str
    stage: str
    progress: int
    eta_seconds: int | None
    error_message: str | None
    duration_s: float | None
    transcript: str | None
    summary: str | None
    watermarked: bool
    ai_labelled: bool
    quality_score: float | None = None
    quality_method: str | None = None
    render_seed: int | None = None
    render_attempts: int = 0
    engine_version: str | None = None
    preview_status: str
    kind: str = "video"
    source_video_id: str | None = None
    preview_progress: int = 0
    reactions: dict[str, int] = {}
    share_enabled: bool
    share_token: str | None
    share_has_password: bool = False
    views: int
    output_url: str | None = None
    output_captioned_url: str | None = None
    srt_url: str | None = None
    thumbnail_url: str | None = None
    preview_url: str | None = None
    share_url: str | None = None
    created_at: datetime
    completed_at: datetime | None


class VideoList(BaseModel):
    items: list[VideoOut]
    next_cursor: str | None = None


class ShareIn(BaseModel):
    enabled: bool = True
    password: str | None = Field(default=None, max_length=100)


class JobOut(Out):
    id: str
    type: str
    status: str
    stage: str
    progress: int
    eta_seconds: int | None
    error: str | None
    video_id: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


# --- Share page (public) ------------------------------------------------------
class ShareMeta(BaseModel):
    title: str
    creator: str
    needs_password: bool
    ai_labelled: bool
    watermarked: bool
    summary: str | None = None


class ShareView(BaseModel):
    title: str
    creator: str
    summary: str | None
    transcript: str | None
    duration_s: float | None
    aspect: str
    video_url: str
    captioned_url: str | None
    thumbnail_url: str | None
    views: int
    reactions: dict[str, int]
    ai_labelled: bool
    watermarked: bool


class UnlockIn(BaseModel):
    password: str | None = None


class ReactIn(BaseModel):
    emoji: Literal["❤️", "🔥", "👏", "😂", "🤯", "👍"]


# --- Credits ------------------------------------------------------------------
class CreditsOut(BaseModel):
    balance: int
    plan: str
    price_per_credit_inr: int
    free_preview_seconds: int


class LedgerEntryOut(Out):
    id: str
    kind: str
    amount: int
    note: str
    video_id: str | None
    job_id: str | None
    created_at: datetime


class DevGrantIn(BaseModel):
    amount: int = Field(gt=0, le=10000)


# --- AI -----------------------------------------------------------------------
class ScriptHelpIn(BaseModel):
    brief: str = Field(min_length=3, max_length=4000)
    audience: str = Field(default="creators and small business owners in India", max_length=300)
    language: Language = "en"
    target_seconds: int = Field(default=60, ge=10, le=600)


class ScriptHelpOut(BaseModel):
    script: str
    words: int
    seconds: int
    model: str
    guardrails: list[GuardrailOut] = []
