import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  updateUserSchema,
  createChannelSchema,
  updateChannelSchema,
  createPolicySchema,
  updatePolicySchema,
  createGroupSchema,
  updateGroupSchema,
  addGroupMemberSchema,
  updateGroupMemberSchema,
  paginationSchema,
} from '@clawix/shared';
import type {
  CreateUserInput,
  UpdateUserInput,
  CreateChannelInput,
  UpdateChannelInput,
  CreatePolicyInput,
  UpdatePolicyInput,
  CreateGroupInput,
  UpdateGroupInput,
  AddGroupMemberInput,
  UpdateGroupMemberInput,
  PaginationInput,
} from '@clawix/shared';
import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';
import { CapacityService } from '../engine/capacity.service.js';

@ApiTags('admin')
@Controller('admin')
@Roles(UserRole.admin)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly capacityService: CapacityService,
  ) {}

  /** Pool capacity vs committed load — over-commit visibility (#198). */
  @Get('capacity')
  capacity() {
    return this.capacityService.report();
  }

  @Get('users')
  listUsers(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('users')
  async createUser(@Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput) {
    const user = await this.adminService.createUser(body);
    // Warn-and-allow onboarding guard (#198): surfacing over-commit here,
    // at decision time, instead of as a runtime capacity lottery.
    const capacityWarning = await this.capacityService.onboardingWarning();
    return capacityWarning ? { ...user, capacityWarning } : user;
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.adminService.updateUser(id, body);
  }

  @Delete('users/:id')
  removeUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // ---- Channels ---- //

  @Get('channels')
  listChannels(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.adminService.listChannels(query);
  }

  @Get('channels/status')
  getChannelStatus() {
    return { connectedIds: this.adminService.getConnectedChannelIds() };
  }

  @Get('channels/:id')
  getChannel(@Param('id') id: string) {
    return this.adminService.getChannel(id);
  }

  @Post('channels')
  createChannel(@Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelInput) {
    return this.adminService.createChannel(body);
  }

  @Patch('channels/:id')
  updateChannel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelInput,
  ) {
    return this.adminService.updateChannel(id, body);
  }

  @Delete('channels/:id')
  removeChannel(@Param('id') id: string) {
    return this.adminService.deleteChannel(id);
  }

  // ---- Policies ---- //

  @Get('policies')
  listPolicies(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.adminService.listPolicies(query);
  }

  @Get('policies/:id')
  getPolicy(@Param('id') id: string) {
    return this.adminService.getPolicy(id);
  }

  @Post('policies')
  createPolicy(@Body(new ZodValidationPipe(createPolicySchema)) body: CreatePolicyInput) {
    return this.adminService.createPolicy(body);
  }

  @Patch('policies/:id')
  updatePolicy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePolicySchema)) body: UpdatePolicyInput,
  ) {
    return this.adminService.updatePolicy(id, body);
  }

  @Delete('policies/:id')
  removePolicy(@Param('id') id: string) {
    return this.adminService.deletePolicy(id);
  }

  // ---- Groups ---- //

  @Get('groups')
  listGroups(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.adminService.listGroups(query);
  }

  @Get('groups/:id')
  getGroup(@Param('id') id: string) {
    return this.adminService.getGroup(id);
  }

  @Post('groups')
  createGroup(
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
    @Req() req: { user: { sub: string } },
  ) {
    return this.adminService.createGroup(body, req.user.sub);
  }

  @Patch('groups/:id')
  updateGroup(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
  ) {
    return this.adminService.updateGroup(id, body);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string) {
    return this.adminService.deleteGroup(id);
  }

  @Get('groups/:id/members')
  listGroupMembers(@Param('id') id: string) {
    return this.adminService.listGroupMembers(id);
  }

  @Post('groups/:id/members')
  addGroupMember(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addGroupMemberSchema)) body: AddGroupMemberInput,
  ) {
    return this.adminService.addGroupMember(id, body);
  }

  @Delete('groups/:id/members/:userId')
  removeGroupMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.adminService.removeGroupMember(id, userId);
  }

  @Patch('groups/:id/members/:userId')
  updateGroupMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateGroupMemberSchema)) body: UpdateGroupMemberInput,
  ) {
    return this.adminService.updateGroupMemberRole(id, userId, body);
  }

  @Get('system')
  getSystemSettings() {
    return { message: 'Not implemented' };
  }

  @Patch('system')
  updateSystemSettings(@Body() _body: unknown) {
    return { message: 'Not implemented' };
  }
}
