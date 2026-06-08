import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = process.env.JWT_SECRET || "dev-ai-qa-copilot-secret-change-me";
const issuer = "ai-qa-copilot";

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function parseExpiry(value = process.env.JWT_EXPIRES_IN || "8h") {
  const match = value.match(/^(\d+)([mhd])$/);
  if (!match) return 8 * 60 * 60;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  return amount * 24 * 60 * 60;
}

export function signAccessToken(userId: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + parseExpiry();
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    iss: issuer,
    iat: issuedAt,
    exp: expiresAt,
    jti: randomBytes(8).toString("hex"),
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return {
    accessToken: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export function verifyAccessToken(token: string) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;
  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    sub?: string;
    iss?: string;
    exp?: number;
  };
  if (payload.iss !== issuer || !payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.sub;
}
