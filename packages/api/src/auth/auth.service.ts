import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../cache/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BCRYPT_SALT_ROUNDS_DEFAULT,
  JWT_ACCESS_EXPIRY,
  LOGIN_FAIL_PREFIX,
  LOGIN_FAIL_TTL_SECONDS,
  MAX_DELAY_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';
import type { JwtPayload, TokenPair } from './auth.types.js';

const FAIL_COUNT_SUFFIX = ':count';
const FAIL_TS_SUFFIX = ':ts';

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  readonly saltRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    this.saltRounds = Number(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? BCRYPT_SALT_ROUNDS_DEFAULT,
    );
  }

  async login(email: string, password: string): Promise<TokenPair> {
    await this.checkLoginDelay(email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { policy: { select: { name: true } } },
    });

    if (!user || !user.isActive) {
      await this.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await compare(password, user.passwordHash);
    if (!passwordValid) {
      await this.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.clearFailedAttempts(email);

    return this.generateTokenPair({
      sub: user.id,
      email: user.email,
      role: user.role,
      policyName: user.policy?.name ?? 'Standard',
    });
  }

  private async checkLoginDelay(email: string): Promise<void> {
    const base = `${LOGIN_FAIL_PREFIX}${email}`;
    const [count, lastAttempt] = await this.redis.mget<number>([
      `${base}${FAIL_COUNT_SUFFIX}`,
      `${base}${FAIL_TS_SUFFIX}`,
    ]);
    if (!count || !lastAttempt) return;

    const requiredDelayMs = Math.min(2 ** count, MAX_DELAY_SECONDS) * 1000;
    const elapsedMs = Date.now() - lastAttempt;
    if (elapsedMs < requiredDelayMs) {
      const remaining = Math.ceil((requiredDelayMs - elapsedMs) / 1000);
      throw new TooManyRequestsException(`Too many attempts. Try again in ${remaining}s`);
    }
  }

  private async recordFailedAttempt(email: string): Promise<void> {
    const base = `${LOGIN_FAIL_PREFIX}${email}`;
    const countKey = `${base}${FAIL_COUNT_SUFFIX}`;
    const tsKey = `${base}${FAIL_TS_SUFFIX}`;
    await this.redis.incr(countKey);
    await this.redis.expire(countKey, LOGIN_FAIL_TTL_SECONDS);
    await this.redis.set(tsKey, Date.now(), { ttlSeconds: LOGIN_FAIL_TTL_SECONDS });
  }

  private async clearFailedAttempts(email: string): Promise<void> {
    const base = `${LOGIN_FAIL_PREFIX}${email}`;
    await this.redis.del(`${base}${FAIL_COUNT_SUFFIX}`);
    await this.redis.del(`${base}${FAIL_TS_SUFFIX}`);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const userId = await this.redis.get<string>(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Validate the user is still active BEFORE revoking the refresh token.
    // Otherwise an inactive-user refresh would burn the only token the client
    // holds, preventing any retry path.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { policy: { select: { name: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Revoke old refresh token only after the user check passes.
    await this.redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);

    return this.generateTokenPair({
      sub: user.id,
      email: user.email,
      role: user.role,
      policyName: user.policy?.name ?? 'Standard',
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
  }

  async validateJwtPayload(payload: JwtPayload): Promise<JwtPayload | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });

    if (!user?.isActive) {
      return null;
    }

    return payload;
  }

  private async generateTokenPair(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = this.jwt.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: JWT_ACCESS_EXPIRY,
    });

    const refreshToken = randomBytes(32).toString('hex');

    await this.redis.set(`${REFRESH_TOKEN_PREFIX}${refreshToken}`, payload.sub, {
      ttlSeconds: REFRESH_TOKEN_TTL_SECONDS,
    });

    return { accessToken, refreshToken };
  }
}
