import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../cache/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BCRYPT_SALT_ROUNDS_DEFAULT,
  JWT_ACCESS_EXPIRY,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';
import type { JwtPayload, TokenPair } from './auth.types.js';

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
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { policy: { select: { name: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokenPair({
      sub: user.id,
      email: user.email,
      role: user.role,
      policyName: user.policy?.name ?? 'Standard',
    });
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
