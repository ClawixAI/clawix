import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from '../auth.controller.js';
import { AuthService } from '../auth.service.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_COOKIE_MAX_AGE,
} from '../auth.constants.js';

interface CookieCall {
  name: string;
  value: string;
  opts: Record<string, unknown>;
}

interface ClearCall {
  name: string;
  opts: Record<string, unknown>;
}

interface FakeReply {
  setCookieCalls: CookieCall[];
  clearCookieCalls: ClearCall[];
  setCookie: (name: string, value: string, opts: Record<string, unknown>) => FakeReply;
  clearCookie: (name: string, opts: Record<string, unknown>) => FakeReply;
}

function makeReply(): FakeReply {
  const r: FakeReply = {
    setCookieCalls: [],
    clearCookieCalls: [],
    setCookie(name, value, opts) {
      this.setCookieCalls.push({ name, value, opts });
      return this;
    },
    clearCookie(name, opts) {
      this.clearCookieCalls.push({ name, opts });
      return this;
    },
  };
  return r;
}

function makeRequest(
  cookies: Record<string, string> = {},
  protocol: 'http' | 'https' = 'https',
): FastifyRequest {
  return { cookies, protocol } as unknown as FastifyRequest;
}

describe('AuthController — cookie handling', () => {
  let authService: {
    login: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      login: vi.fn().mockResolvedValue({ accessToken: 'access-abc', refreshToken: 'refresh-xyz' }),
      refresh: vi
        .fn()
        .mockResolvedValue({ accessToken: 'access-new', refreshToken: 'refresh-new' }),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  describe('POST /auth/login', () => {
    it('returns accessToken in body and sets refresh cookie with httpOnly + sameSite=strict', async () => {
      const reply = makeReply();
      const req = makeRequest({}, 'https');
      const result = await controller.login(
        { email: 'admin@clawix.test', password: 'password1234' },
        req,
        reply as unknown as FastifyReply,
      );

      // Backward-compat: body still includes refreshToken so existing
      // localStorage-based clients keep working until web migration lands.
      expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-xyz' });

      // Cookie set with proper flags
      expect(reply.setCookieCalls).toHaveLength(1);
      const call = reply.setCookieCalls[0]!;
      expect(call.name).toBe(REFRESH_COOKIE_NAME);
      expect(call.value).toBe('refresh-xyz');
      expect(call.opts).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_COOKIE_MAX_AGE,
      });
    });

    it('sets secure=true on the refresh cookie when the request scheme is https', async () => {
      const reply = makeReply();
      const req = makeRequest({}, 'https');
      await controller.login(
        { email: 'admin@clawix.test', password: 'password1234' },
        req,
        reply as unknown as FastifyReply,
      );
      expect(reply.setCookieCalls[0]!.opts).toMatchObject({ secure: true });
    });

    it('sets secure=false on the refresh cookie when the request scheme is http', async () => {
      const reply = makeReply();
      const req = makeRequest({}, 'http');
      await controller.login(
        { email: 'admin@clawix.test', password: 'password1234' },
        req,
        reply as unknown as FastifyReply,
      );
      expect(reply.setCookieCalls[0]!.opts).toMatchObject({ secure: false });
    });
  });

  describe('POST /auth/refresh', () => {
    it('reads refreshToken from cookie when present (cookie wins over body)', async () => {
      const reply = makeReply();
      const req = makeRequest({ [REFRESH_COOKIE_NAME]: 'cookie-token' });

      const result = await controller.refresh(
        { refreshToken: 'body-token-ignored' },
        req,
        reply as unknown as FastifyReply,
      );

      expect(authService.refresh).toHaveBeenCalledWith('cookie-token');
      expect(result).toEqual({ accessToken: 'access-new', refreshToken: 'refresh-new' });

      // New refresh cookie is rotated
      expect(reply.setCookieCalls).toHaveLength(1);
      expect(reply.setCookieCalls[0]).toMatchObject({
        name: REFRESH_COOKIE_NAME,
        value: 'refresh-new',
      });
    });

    it('falls back to body when no cookie present (backward compat for curl/scripts)', async () => {
      const reply = makeReply();
      const req = makeRequest({});

      await controller.refresh(
        { refreshToken: 'body-token' },
        req,
        reply as unknown as FastifyReply,
      );

      expect(authService.refresh).toHaveBeenCalledWith('body-token');
    });

    it('rotates a secure cookie when the refresh request arrives over https', async () => {
      const reply = makeReply();
      const req = makeRequest({ [REFRESH_COOKIE_NAME]: 'cookie-token' }, 'https');

      await controller.refresh({ refreshToken: '' }, req, reply as unknown as FastifyReply);

      expect(reply.setCookieCalls[0]!.opts).toMatchObject({ secure: true });
    });

    it('rotates a non-secure cookie when the refresh request arrives over http', async () => {
      const reply = makeReply();
      const req = makeRequest({ [REFRESH_COOKIE_NAME]: 'cookie-token' }, 'http');

      await controller.refresh({ refreshToken: '' }, req, reply as unknown as FastifyReply);

      expect(reply.setCookieCalls[0]!.opts).toMatchObject({ secure: false });
    });
  });

  describe('POST /auth/logout', () => {
    it('reads cookie when present, clears it on response', async () => {
      const reply = makeReply();
      const req = makeRequest({ [REFRESH_COOKIE_NAME]: 'cookie-token' });

      await controller.logout(
        { refreshToken: 'body-token-ignored' },
        req,
        reply as unknown as FastifyReply,
      );

      expect(authService.logout).toHaveBeenCalledWith('cookie-token');
      expect(reply.clearCookieCalls).toHaveLength(1);
      expect(reply.clearCookieCalls[0]).toMatchObject({
        name: REFRESH_COOKIE_NAME,
        opts: { path: REFRESH_COOKIE_PATH },
      });
    });

    it('falls back to body refreshToken when no cookie (backward compat)', async () => {
      const reply = makeReply();
      const req = makeRequest({});

      await controller.logout(
        { refreshToken: 'body-token' },
        req,
        reply as unknown as FastifyReply,
      );

      expect(authService.logout).toHaveBeenCalledWith('body-token');
      // Cookie still cleared (idempotent — sends Set-Cookie with past expiry)
      expect(reply.clearCookieCalls).toHaveLength(1);
    });
  });
});
