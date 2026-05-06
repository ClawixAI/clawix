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

interface LoginFailRecord {
  count: number;
  lastAttempt: number;
}

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
    const failData = await this.redis.get<LoginFailRecord>(`${LOGIN_FAIL_PREFIX}${email}`);
    if (!failData) return;

    const requiredDelayMs = Math.min(2 ** failData.count, MAX_DELAY_SECONDS) * 1000;
    const elapsedMs = Date.now() - failData.lastAttempt;
    if (elapsedMs < requiredDelayMs) {
      const remaining = Math.ceil((requiredDelayMs - elapsedMs) / 1000);
      throw new TooManyRequestsException(`Too many attempts. Try again in ${remaining}s`);
    }
  }

  private async recordFailedAttempt(email: string): Promise<void> {
    const key = `${LOGIN_FAIL_PREFIX}${email}`;
    const existing = await this.redis.get<LoginFailRecord>(key);
    await this.redis.set(
      key,
      { count: (existing?.count ?? 0) + 1, lastAttempt: Date.now() },
      { ttlSeconds: LOGIN_FAIL_TTL_SECONDS },
    );
  }

  private async clearFailedAttempts(email: string): Promise<void> {
    await this.redis.del(`${LOGIN_FAIL_PREFIX}${email}`);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const userId = await this.redis.get<string>(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old refresh token
    await this.redis.del(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { policy: { select: { name: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

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
