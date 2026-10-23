import { apiFetch, apiForm } from "./api";
import type {
  AccessIn,
  AdminUsageOut,
  ApiKeyCreate,
  ClipIn,
  ClipStartOut,
  JobStatusOut,
  NotifyPrefs,
  PlanIn,
  ResumeOut,
  TranslateIn,
  TranslateLanguage,
  TranslateOut,
  VideoPlanOut,
  ApiKeyOut,
  BatchCsvIn,
  BatchOut,
  BillingOut,
  CancelOut,
  CheckoutIn,
  CheckoutOut,
  ConfirmIn,
  ConfirmOut,
  ConnectionOut,
  DeliveryOut,
  InviteIn,
  InviteMeta,
  InviteOut,
  RoleOut,
  Role,
  SeatsCheckoutOut,
  SeatsOut,
  WebhookEventsOut,
  WebhookIn,
  WebhookOut,
  WorkspaceCreate,
  ConnectionSaveIn,
  ConnectionTestOut,
  CreditsOut,
  DesignIn,
  EstimateIn,
  EstimateOut,
  GoldenIn,
  GoldenReportOut,
  IdentityCreate,
  IdentityJob,
  IdentityOut,
  JobStartOut,
  LabEnginesOut,
  Language,
  LedgerEntryOut,
  LibraryVoiceOut,
  LookCreate,
  LookGenerateIn,
  LookOut,
  LookPackOut,
  MeOut,
  MemberOut,
  ProjectOut,
  PublicConfig,
  ReactionEmoji,
  ReferenceIn,
  ScriptHelpIn,
  ScoreIn,
  ScriptHelpOut,
  ShareIn,
  ShareMeta,
  ShareView,
  SummaryOut,
  TrialIn,
  TrialOut,
  VideoCreate,
  VideoList,
  VideoOut,
  VideoPatch,
  VoiceAdopt,
  VoiceClone,
  VoiceOut,
  VoicePatch,
  WhoamiOut,
  WorkspaceOut,
  WorkspacePatch,
} from "./types";

export const api = {
  me: () => apiFetch<MeOut>("/me"),
  /* v3: WhatsApp notifications. phone is E.164 (+919876543210). */
  notifications: {
    get: () => apiFetch<NotifyPrefs>("/me/notifications"),
    set: (body: NotifyPrefs) => apiFetch<NotifyPrefs>("/me/notifications", { method: "PUT", body }),
  },
  workspace: {
    patch: (body: WorkspacePatch) => apiFetch<WorkspaceOut>("/workspaces/current", { method: "PATCH", body }),
    members: () => apiFetch<MemberOut[]>("/workspaces/current/members"),
    /* v3: teams. Switching = X-Workspace-Id (setWorkspaceId in auth.ts). */
    create: (body: WorkspaceCreate) => apiFetch<WorkspaceOut>("/workspaces", { body }),
    seats: () => apiFetch<SeatsOut>("/workspaces/current/seats"),
    invites: () => apiFetch<InviteOut[]>("/workspaces/current/invites"),
    /** 402 seat_limit when the plan is full, 409 already_member. */
    invite: (body: InviteIn) => apiFetch<InviteOut>("/workspaces/current/invites", { body }),
    revokeInvite: (id: string) => apiFetch<void>(`/workspaces/current/invites/${id}`, { method: "DELETE" }),
    /** 403 forbidden (only an owner can make an owner), 400 last_owner. */
    setRole: (userId: string, role: Role) => apiFetch<RoleOut>(`/workspaces/current/members/${userId}`, { method: "PATCH", body: { role } }),
    removeMember: (userId: string) => apiFetch<void>(`/workspaces/current/members/${userId}`, { method: "DELETE" }),
    leave: () => apiFetch<void>("/workspaces/current/leave", { method: "POST" }),
  },
  invites: {
    /** Public: who invited whom, and whether the link is still good. */
    meta: (token: string) => apiFetch<InviteMeta>(`/invites/${encodeURIComponent(token)}`, { anonymous: true }),
    /** Signed in. 403 wrong_account, 409 used, 410 expired. */
    accept: (token: string) => apiFetch<WorkspaceOut>(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST" }),
  },
  identities: {
    list: () => apiFetch<IdentityOut[]>("/identities"),
    get: (id: string) => apiFetch<IdentityOut>(`/identities/${id}`),
    create: (body: IdentityCreate) => apiFetch<IdentityOut>("/identities", { body }),
    patch: (id: string, name: string) => apiFetch<IdentityOut>(`/identities/${id}`, { method: "PATCH", body: { name } }),
    remove: (id: string) => apiFetch<void>(`/identities/${id}`, { method: "DELETE" }),
    reference: (id: string, body: ReferenceIn) => apiFetch<IdentityOut>(`/identities/${id}/reference`, { body }),
    addLook: (id: string, body: LookCreate) => apiFetch<LookOut>(`/identities/${id}/looks`, { body }),
    removeLook: (id: string, lookId: string) => apiFetch<void>(`/identities/${id}/looks/${lookId}`, { method: "DELETE" }),
    defaultLook: (id: string, lookId: string) =>
      apiFetch<IdentityOut>(`/identities/${id}/looks/${lookId}/default`, { method: "POST" }),
    renameLook: (id: string, lookId: string, name: string) =>
      apiFetch<LookOut>(`/identities/${id}/looks/${lookId}`, { method: "PATCH", body: { name } }),
    /* v2 */
    addFootage: (id: string, key: string) => apiFetch<IdentityOut>(`/identities/${id}/footage`, { body: { key } }),
    removeFootage: (id: string, key: string) => apiFetch<IdentityOut>(`/identities/${id}/footage`, { method: "DELETE", body: { key } }),
    /** 40 credits, charged only when training finishes. 422 blocked, 409 busy, 402 insufficient_credits. */
    trainStyle: (id: string) => apiFetch<JobStartOut>(`/identities/${id}/train-style`, { method: "POST" }),
    /** 2 credits for a look (3 variants), 6 for camera angles (3 angles). */
    generateLooks: (id: string, body: LookGenerateIn) => apiFetch<JobStartOut>(`/identities/${id}/looks/generate`, { body }),
    lookPacks: () => apiFetch<LookPackOut[]>("/identities/look-packs"),
    /** Designed avatars only: 3 candidates for 2 credits; the first becomes the default look. */
    design: (id: string, body: DesignIn) => apiFetch<JobStartOut>(`/identities/${id}/design`, { body }),
    jobs: (id: string) => apiFetch<IdentityJob[]>(`/identities/${id}/jobs`),
    /* v3: per-avatar access (owners and admins). Empty list = everyone. */
    setAccess: (id: string, body: AccessIn) => apiFetch<IdentityOut>(`/identities/${id}/access`, { method: "PUT", body }),
  },
  voices: {
    list: () => apiFetch<VoiceOut[]>("/voices"),
    library: (language?: Language | "") =>
      apiFetch<LibraryVoiceOut[]>("/voices/library", { query: { language: language || undefined } }),
    adopt: (body: VoiceAdopt) => apiFetch<VoiceOut>("/voices", { body }),
    clone: (body: VoiceClone) => apiFetch<VoiceOut>("/voices/clone", { body }),
    importKey: (api_key: string) => apiFetch<VoiceOut[]>("/voices/import-key", { body: { api_key } }),
    patch: (id: string, body: VoicePatch) => apiFetch<VoiceOut>(`/voices/${id}`, { method: "PATCH", body }),
    remove: (id: string) => apiFetch<void>(`/voices/${id}`, { method: "DELETE" }),
    preview: (id: string, body: { text?: string; language?: Language } = {}) =>
      apiFetch<VoiceOut>(`/voices/${id}/preview`, { body }),
  },
  projects: {
    list: () => apiFetch<ProjectOut[]>("/projects"),
    create: (name: string) => apiFetch<ProjectOut>("/projects", { body: { name } }),
    rename: (id: string, name: string) => apiFetch<ProjectOut>(`/projects/${id}`, { method: "PATCH", body: { name } }),
    remove: (id: string) => apiFetch<void>(`/projects/${id}`, { method: "DELETE" }),
  },
  videos: {
    estimate: (body: EstimateIn, signal?: AbortSignal) => apiFetch<EstimateOut>("/videos/estimate", { body, signal }),
    list: (q: { status?: string; project_id?: string; q?: string; cursor?: string; limit?: number } = {}) =>
      apiFetch<VideoList>("/videos", { query: q }),
    get: (id: string) => apiFetch<VideoOut>(`/videos/${id}`),
    create: (body: VideoCreate) => apiFetch<VideoOut>("/videos", { body }),
    patch: (id: string, body: VideoPatch) => apiFetch<VideoOut>(`/videos/${id}`, { method: "PATCH", body }),
    remove: (id: string) => apiFetch<void>(`/videos/${id}`, { method: "DELETE" }),
    preview: (id: string) => apiFetch<VideoOut>(`/videos/${id}/preview`, { method: "POST" }),
    generate: (id: string) => apiFetch<VideoOut>(`/videos/${id}/generate`, { method: "POST" }),
    cancel: (id: string) => apiFetch<VideoOut>(`/videos/${id}/cancel`, { method: "POST" }),
    duplicate: (id: string) => apiFetch<VideoOut>(`/videos/${id}/duplicate`, { method: "POST" }),
    share: (id: string, body: ShareIn) => apiFetch<VideoOut>(`/videos/${id}/share`, { body }),
    /** v3: up to 100 rows. Credits for the whole batch are checked first (402 insufficient_credits keeps the drafts). */
    batchCsv: ({ file, ...fields }: BatchCsvIn) => apiForm<BatchOut>("/videos/batch/csv", { file, ...fields }, file.name),
    /* v3: translations and clips are ordinary videos with kind "translation" | "clip" and source_video_id. */
    /** 202; one new video per language. 400 same_language/bad_language, 402 insufficient_credits (drafts kept), 422 blocked, 503 assistant_unavailable. */
    translate: (id: string, body: TranslateIn) => apiFetch<TranslateOut>(`/videos/${id}/translate`, { body }),
    /** Translations and clips made from this video. */
    derived: (id: string) => apiFetch<VideoOut[]>(`/videos/${id}/derived`),
    /** 202 with a job to poll at jobs.status(). 409 not_ready before the source rendered, 402 insufficient_credits. */
    clip: (id: string, body: ClipIn) => apiFetch<ClipStartOut>(`/videos/${id}/clip`, { body }),
  },
  translate: {
    languages: () => apiFetch<TranslateLanguage[]>("/translate/languages"),
  },
  jobs: {
    status: (id: string) => apiFetch<JobStatusOut>(`/jobs/${id}/status`),
  },
  share: {
    meta: (token: string) => apiFetch<ShareMeta>(`/share/${encodeURIComponent(token)}`, { anonymous: true }),
    view: (token: string, password?: string) =>
      apiFetch<ShareView>(`/share/${encodeURIComponent(token)}/view`, { body: { password: password ?? null }, anonymous: true }),
    react: (token: string, emoji: ReactionEmoji) =>
      apiFetch<Record<string, number>>(`/share/${encodeURIComponent(token)}/react`, { body: { emoji }, anonymous: true }),
  },
  credits: {
    get: () => apiFetch<CreditsOut>("/credits"),
    ledger: (limit = 200) => apiFetch<LedgerEntryOut[]>("/credits/ledger", { query: { limit } }),
    devGrant: (amount: number) => apiFetch<CreditsOut>("/credits/dev-grant", { body: { amount } }),
  },
  ai: {
    script: (body: ScriptHelpIn) => apiFetch<ScriptHelpOut>("/ai/script", { body }),
    /** v3 Video Agent: brief → scene plan + script. A mock planner answers without Claude; 503 assistant_unavailable otherwise. */
    plan: (body: PlanIn) => apiFetch<VideoPlanOut>("/ai/plan", { body }),
  },
  config: {
    /** Read before sign-in: auth mode, Clerk key, which engines are live. */
    public: () => apiFetch<PublicConfig>("/config/public", { anonymous: true }),
  },
  admin: {
    whoami: () => apiFetch<WhoamiOut>("/admin/whoami"),
    connections: () => apiFetch<ConnectionOut[]>("/admin/connections"),
    save: (id: string, body: ConnectionSaveIn) => apiFetch<ConnectionOut>(`/admin/connections/${id}`, { method: "PUT", body }),
    test: (id: string) => apiFetch<ConnectionTestOut>(`/admin/connections/${id}/test`, { method: "POST" }),
    /** v3: platform-wide usage for the last `days` days (7/30/90). */
    usage: (days = 30) => apiFetch<AdminUsageOut>("/admin/usage", { query: { days } }),
  },
  billing: {
    get: () => apiFetch<BillingOut>("/billing"),
    /** kind plan/topup → a checkout intent; kind seats → {ok, seats}. Owners and admins only. */
    checkout: (body: CheckoutIn) => apiFetch<CheckoutOut>("/billing/checkout", { body }),
    seats: (seats: number) => apiFetch<SeatsCheckoutOut>("/billing/checkout", { body: { kind: "seats", seats } satisfies CheckoutIn }),
    /** Razorpay: the Checkout.js success handler response. Mock: {provider_subscription_id | provider_order_id, amount, currency}. */
    confirm: (body: ConfirmIn) => apiFetch<ConfirmOut>("/billing/confirm", { body }),
    cancel: () => apiFetch<CancelOut>("/billing/cancel", { method: "POST" }),
    /** Keep a cancelled plan that has not ended yet. 409 cannot_resume. */
    resume: () => apiFetch<ResumeOut>("/billing/resume", { method: "POST" }),
    /* Invoices: payments[].invoice_url is a signed link that opens in a plain <a target=_blank>; no fetch needed. */
  },
  developer: {
    keys: () => apiFetch<ApiKeyOut[]>("/api-keys"),
    /** The answer carries `key` once; it is never shown again. 402 plan_required in production. */
    createKey: (body: ApiKeyCreate) => apiFetch<ApiKeyOut>("/api-keys", { body }),
    revokeKey: (id: string) => apiFetch<void>(`/api-keys/${id}`, { method: "DELETE" }),
    events: () => apiFetch<WebhookEventsOut>("/webhooks/events"),
    webhooks: () => apiFetch<WebhookOut[]>("/webhooks"),
    createWebhook: (body: WebhookIn) => apiFetch<WebhookOut>("/webhooks", { body }),
    updateWebhook: (id: string, body: WebhookIn) => apiFetch<WebhookOut>(`/webhooks/${id}`, { method: "PATCH", body }),
    removeWebhook: (id: string) => apiFetch<void>(`/webhooks/${id}`, { method: "DELETE" }),
    /** Sends test.ping right now and answers with the delivery. */
    testWebhook: (id: string) => apiFetch<DeliveryOut>(`/webhooks/${id}/test`, { method: "POST" }),
    deliveries: (id: string, limit = 50) => apiFetch<DeliveryOut[]>(`/webhooks/${id}/deliveries`, { query: { limit } }),
    replay: (deliveryId: string) => apiFetch<DeliveryOut>(`/webhooks/deliveries/${deliveryId}/replay`, { method: "POST" }),
  },
  lab: {
    engines: () => apiFetch<LabEnginesOut>("/lab/engines"),
    trials: () => apiFetch<TrialOut[]>("/lab/trials"),
    createTrial: (body: TrialIn) => apiFetch<TrialOut>("/lab/trials", { body }),
    score: (id: string, body: ScoreIn) => apiFetch<TrialOut>(`/lab/trials/${id}/scores`, { body }),
    rerun: (id: string) => apiFetch<TrialOut>(`/lab/trials/${id}/rerun`, { method: "POST" }),
    remove: (id: string) => apiFetch<void>(`/lab/trials/${id}`, { method: "DELETE" }),
    summary: () => apiFetch<SummaryOut>("/lab/summary"),
    adopt: (engine: string) => apiFetch<{ default_engine_photo: string }>(`/lab/adopt/${engine}`, { method: "POST" }),
    /* Golden set: regression baselines rerun with the same seed after any engine or settings change. */
    setGolden: (id: string, is_golden: boolean) => apiFetch<TrialOut>(`/lab/trials/${id}/golden`, { method: "PUT", body: { is_golden } satisfies GoldenIn }),
    /** 202 with the new trials. 404 no_golden when nothing is marked yet. */
    rerunGolden: () => apiFetch<TrialOut[]>("/lab/golden/rerun", { method: "POST" }),
    golden: () => apiFetch<GoldenReportOut>("/lab/golden"),
    /** Markdown text of docs/STAGE0_RESULTS.md; download it with apiBlob("/lab/results.md"). */
  },
};
