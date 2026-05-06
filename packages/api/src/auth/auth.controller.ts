import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, refreshSchema, type LoginInput, type RefreshInput } from '@clawix/shared';
import {
  AUTH_THROTTLE_TTL_MS,
  LOGIN_THROTTLE_BLOCK_MS,
  LOGIN_THROTTLE_LIMIT,
  REFRESH_THROTTLE_LIMIT,
} from '../common/throttle.config.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';
import {
  REFRESH_COOKIE_MAX_AGE,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from './auth.constants.js';

function setRefreshCookie(req: FastifyRequest, reply: FastifyReply, refreshToken: string): void {
  // Browsers silently drop Secure cookies on http:// — derive the flag from
  // the request scheme so the same image works for tailnet/LAN HTTP and a
  // TLS-terminating proxy. Trust X-Forwarded-Proto via Fastify trustProxy.
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: req.protocol === 'https',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({
    default: {
      limit: LOGIN_THROTTLE_LIMIT,
      ttl: AUTH_THROTTLE_TTL_MS,
      blockDuration: LOGIN_THROTTLE_BLOCK_MS,
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.authService.login(body.email, body.password);
    setRefreshCookie(req, reply, tokens.refreshToken);
    // Body still includes refreshToken for backward compat with localStorage
    // clients and scripts. Web migration in Tasks 7-9 will stop reading it.
    return tokens;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] ?? body.refreshToken;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    clearRefreshCookie(reply);
  }

  @Public()
  @Throttle({
    default: {
      limit: REFRESH_THROTTLE_LIMIT,
      ttl: AUTH_THROTTLE_TTL_MS,
    },
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] ?? body.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }
    const tokens = await this.authService.refresh(refreshToken);
    setRefreshCookie(req, reply, tokens.refreshToken);
    return tokens;
  }
}
