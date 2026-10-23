import { createHmac, timingSafeEqual } from 'crypto';

export interface SignatureCheck {
	ok: boolean;
	reason?: string;
}

/**
 * Verify an `X-AvatarStudio-Signature: t=<unix>,v1=<hex>` header.
 *
 * v1 must equal hex(hmac_sha256(secret, `${t}.${rawBody}`)) and the timestamp
 * must be within `toleranceSeconds` of now (default 300 s).
 */
export function verifyAvatarStudioSignature(
	secret: string,
	rawBody: Buffer | string,
	header: string | undefined,
	toleranceSeconds = 300,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
	if (!secret) return { ok: false, reason: 'no webhook secret configured' };
	if (!header) return { ok: false, reason: 'missing X-AvatarStudio-Signature header' };

	const parts: Record<string, string> = {};
	for (const piece of header.split(',')) {
		const idx = piece.indexOf('=');
		if (idx === -1) continue;
		parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
	}

	const timestamp = Number.parseInt(parts.t ?? '', 10);
	if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed timestamp' };
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
		return { ok: false, reason: 'timestamp outside tolerance' };
	}

	const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
	const expected = createHmac('sha256', secret)
		.update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]))
		.digest('hex');
	const received = (parts.v1 ?? '').toLowerCase();

	if (received.length !== expected.length) return { ok: false, reason: 'bad signature' };
	if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'))) {
		return { ok: false, reason: 'bad signature' };
	}
	return { ok: true };
}
