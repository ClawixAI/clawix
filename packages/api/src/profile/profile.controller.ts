import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { updateProfileSchema, changePasswordSchema } from '@clawix/shared';
import type { UpdateProfileInput, ChangePasswordInput } from '@clawix/shared';
import type { JwtPayload } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProfileService } from './profile.service.js';

@ApiTags('profile')
@Controller('api/v1/me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@Req() req: { user: JwtPayload }) {
    return this.profileService.getProfile(req.user.sub);
  }

  @Patch()
  updateProfile(
    @Req() req: { user: JwtPayload },
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.profileService.updateProfile(req.user.sub, body);
  }

  @Post('password')
  changePassword(
    @Req() req: { user: JwtPayload },
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.profileService.changePassword(req.user.sub, body.currentPassword, body.newPassword);
  }
}
