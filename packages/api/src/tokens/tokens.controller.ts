import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { TokensService } from './tokens.service.js';

interface AuthRequest {
  user: { sub: string; email: string; role: string; policyName: string };
}

@ApiTags('tokens')
@Controller('api/v1/tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('summary')
  getSummary(@Req() req: AuthRequest) {
    const { user } = req;
    return this.tokensService.getSummaryByUser(user.sub);
  }

  @Get('per-user')
  getPerUserBreakdown(@Req() req: AuthRequest) {
    const { user } = req;
    return this.tokensService.getPerUserBreakdown(user.role, user.sub);
  }

  @Get('per-user/:userId/agents')
  getUserAgentBreakdown(@Param('userId') userId: string, @Req() req: AuthRequest) {
    const { user } = req;
    const targetUserId = user.role === 'admin' ? userId : user.sub;
    return this.tokensService.getUserAgentBreakdown(targetUserId);
  }

  @Get('usage-over-time')
  getUsageOverTime(
    @Req() req: AuthRequest,
    @Query('period') period?: string,
    @Query('userId') userId?: string,
  ) {
    const { user } = req;
    const validPeriod =
      period === 'daily' || period === 'weekly' || period === 'monthly' ? period : 'daily';
    const targetUserId = user.role === 'admin' ? userId : user.sub;
    return this.tokensService.getUsageOverTime(validPeriod, targetUserId);
  }
}
