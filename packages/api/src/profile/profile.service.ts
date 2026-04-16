import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';

import type { User } from '../generated/prisma/client.js';
import { UserRepository } from '../db/user.repository.js';
import { BCRYPT_SALT_ROUNDS_DEFAULT } from '../auth/auth.constants.js';

type SafeUser = Omit<User, 'passwordHash'>;

interface UpdateProfileInput {
  readonly name?: string;
  readonly telegramId?: string | null;
}

@Injectable()
export class ProfileService {
  private readonly saltRounds: number;

  constructor(
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
  ) {
    this.saltRounds = Number(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? BCRYPT_SALT_ROUNDS_DEFAULT,
    );
  }

  private stripPassword(user: User): SafeUser {
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async getProfile(userId: string): Promise<SafeUser> {
    return this.stripPassword(await this.userRepo.findById(userId));
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SafeUser> {
    return this.stripPassword(await this.userRepo.update(userId, input));
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const user = await this.userRepo.findById(userId);
    const valid = await compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await hash(newPassword, this.saltRounds);
    await this.userRepo.updatePassword(userId, passwordHash);
    return { success: true };
  }
}
