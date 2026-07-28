import crypto, { JsonWebKey, KeyObject } from "node:crypto";
import jwt, { JwtHeader, JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const APPLE_KEYS_TTL_MS = 60 * 60 * 1000;

interface AppleJwk {
  kid?: string;
  alg?: string;
  [key: string]: string | undefined;
}

interface AppleJwkSet {
  keys?: AppleJwk[];
}

interface AppleIdentityClaims extends JwtPayload {
  email?: string;
  email_verified?: string | boolean;
  nonce?: string;
}

interface AppleTokenResponse {
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export interface VerifiedAppleIdentity {
  appleId: string;
  email?: string;
  clientId: string;
}

export interface VerifiedAppleLogin extends VerifiedAppleIdentity {
  encryptedRefreshToken?: string;
}

export class AppleAuthService {
  private static cachedKeys:
    | { expiresAt: number; keys: Map<string, KeyObject> }
    | undefined;

  static async verifyAndExchange(params: {
    identityToken: string;
    authorizationCode: string;
    rawNonce: string;
  }): Promise<VerifiedAppleLogin> {
    const identity = await this.verifyIdentityToken(
      params.identityToken,
      params.rawNonce
    );
    const refreshToken = await this.exchangeAuthorizationCode(
      params.authorizationCode,
      identity.clientId
    );

    return {
      ...identity,
      encryptedRefreshToken: refreshToken
        ? this.encryptRefreshToken(refreshToken)
        : undefined,
    };
  }

  static async verifyIdentityToken(
    identityToken: string,
    rawNonce: string
  ): Promise<VerifiedAppleIdentity> {
    const clientIds = this.configuredClientIds();
    if (clientIds.length === 0) {
      throw new AppError(503, "Apple login is not configured");
    }

    const decoded = jwt.decode(identityToken, { complete: true });
    const header = decoded?.header as JwtHeader | undefined;
    if (
      !header?.kid ||
      (header.alg !== "RS256" && header.alg !== "ES256")
    ) {
      throw new AppError(401, "Invalid Apple identity token");
    }

    try {
      const publicKey = await this.getApplePublicKey(header.kid);
      const claims = jwt.verify(identityToken, publicKey, {
        algorithms: ["RS256", "ES256"],
        issuer: APPLE_ISSUER,
        audience: clientIds as [string, ...string[]],
      }) as AppleIdentityClaims;

      return this.buildIdentity(claims, rawNonce, clientIds);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Invalid Apple identity token");
    }
  }

  static buildIdentity(
    claims: AppleIdentityClaims,
    rawNonce: string,
    expectedClientIds: readonly string[]
  ): VerifiedAppleIdentity {
    const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    if (!audience || !expectedClientIds.includes(audience)) {
      throw new AppError(
        401,
        "Apple token was not issued for this application"
      );
    }
    if (!claims.sub) {
      throw new AppError(401, "Apple token is missing identity claims");
    }

    const expectedNonce = crypto
      .createHash("sha256")
      .update(rawNonce)
      .digest("hex");
    const suppliedNonce = claims.nonce ?? "";
    if (
      suppliedNonce.length !== expectedNonce.length ||
      !crypto.timingSafeEqual(
        Buffer.from(suppliedNonce),
        Buffer.from(expectedNonce)
      )
    ) {
      throw new AppError(401, "Apple sign-in nonce is invalid");
    }

    const emailVerified =
      claims.email_verified === true || claims.email_verified === "true";
    if (claims.email && !emailVerified) {
      throw new AppError(401, "Apple email is not verified");
    }

    return {
      appleId: claims.sub,
      email: claims.email?.trim().toLowerCase(),
      clientId: audience,
    };
  }

  private static configuredClientIds(): string[] {
    return [env.APPLE_IOS_CLIENT_ID, env.APPLE_SERVICE_CLIENT_ID].filter(
      (value): value is string => Boolean(value?.trim())
    );
  }

  private static async exchangeAuthorizationCode(
    authorizationCode: string,
    clientId: string
  ): Promise<string | undefined> {
    const clientSecret = this.createClientSecret(clientId);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (
      env.APPLE_SERVICE_CLIENT_ID === clientId &&
      env.APPLE_REDIRECT_URI?.trim()
    ) {
      body.set("redirect_uri", env.APPLE_REDIRECT_URI.trim());
    }

    const response = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json()) as AppleTokenResponse;
    if (!response.ok || payload.error) {
      throw new AppError(401, "Apple authorization code is invalid");
    }
    if (!payload.refresh_token) {
      throw new AppError(401, "Apple authorization response is incomplete");
    }
    return payload.refresh_token;
  }

  private static createClientSecret(clientId: string): string {
    const teamId = env.APPLE_TEAM_ID?.trim();
    const keyId = env.APPLE_KEY_ID?.trim();
    const encodedPrivateKey = env.APPLE_PRIVATE_KEY_BASE64?.trim();
    if (!teamId || !keyId || !encodedPrivateKey) {
      throw new AppError(503, "Apple login is not configured");
    }

    let privateKey: string;
    try {
      privateKey = Buffer.from(encodedPrivateKey, "base64").toString("utf8");
      if (!privateKey.includes("BEGIN PRIVATE KEY")) throw new Error();
    } catch {
      throw new AppError(503, "Apple login is not configured");
    }

    return jwt.sign({}, privateKey, {
      algorithm: "ES256",
      keyid: keyId,
      issuer: teamId,
      audience: APPLE_ISSUER,
      subject: clientId,
      expiresIn: "5m",
    });
  }

  private static encryptRefreshToken(refreshToken: string): string {
    const encodedKey = env.APPLE_TOKEN_ENCRYPTION_KEY?.trim();
    if (!encodedKey) {
      throw new AppError(503, "Apple token encryption is not configured");
    }
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) {
      throw new AppError(503, "Apple token encryption is not configured");
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(refreshToken, "utf8"),
      cipher.final(),
    ]);
    return [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  private static async getApplePublicKey(kid: string): Promise<KeyObject> {
    if (
      !this.cachedKeys ||
      this.cachedKeys.expiresAt <= Date.now() ||
      !this.cachedKeys.keys.has(kid)
    ) {
      const response = await fetch(APPLE_KEYS_URL);
      if (!response.ok) {
        throw new AppError(503, "Apple Sign-In is temporarily unavailable");
      }
      const payload = (await response.json()) as AppleJwkSet;
      const keys = new Map<string, KeyObject>();
      for (const jwk of payload.keys ?? []) {
        if (!jwk.kid) continue;
        try {
          keys.set(
            jwk.kid,
            crypto.createPublicKey({
              key: jwk as JsonWebKey,
              format: "jwk",
            })
          );
        } catch {
          // Ignore malformed or unsupported keys returned by the provider.
        }
      }
      this.cachedKeys = {
        expiresAt: Date.now() + APPLE_KEYS_TTL_MS,
        keys,
      };
    }

    const key = this.cachedKeys.keys.get(kid);
    if (!key) throw new AppError(401, "Invalid Apple identity token");
    return key;
  }
}
