/**
 * Consistency (quality gate) labels shared by the video page and the Engine Lab.
 * The API sets quality_method to "face_match" when RunPod ran the InsightFace
 * check, "frame_similarity" when the local proxy compared frames instead.
 */

export type QualityMethodLike = "face_match" | "frame_similarity" | string | null | undefined;

export function qualityMethodName(method: QualityMethodLike): string {
  return method === "face_match" ? "Face match" : "Frame check";
}

/** "Face match 0.78" / "Frame check 0.91"; null when there is no score. */
export function qualityLabel(score: number | null | undefined, method: QualityMethodLike): string | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return `${qualityMethodName(method)} ${score.toFixed(2)}`;
}

/** One plain line that explains how the score was measured. */
export function qualityHint(method: QualityMethodLike): string {
  return method === "face_match" ? "Checked against your reference with a face model." : "Basic frame check (connect RunPod for the face check).";
}

/** Error text the worker uses when the gate gave up; the video page shows reference tips for it. */
export const GATE_FAILURE_TEXT = "did not look enough like you";

export function isGateFailure(message: string | null | undefined): boolean {
  return Boolean(message && message.toLowerCase().includes(GATE_FAILURE_TEXT));
}
