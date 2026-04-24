import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channels')
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Create a new channel' })
  create(@CurrentOrg('id') orgId: string, @Body() dto: CreateChannelDto) {
    return this.service.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all channels for the organization' })
  findAll(@CurrentOrg('id') orgId: string) {
    return this.service.findAll(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  findOne(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.findOne(id, orgId);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update a channel' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'Soft-delete a channel. Requires ?confirmName=<exact channel name>.',
  })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Query('confirmName') confirmName?: string,
  ) {
    return this.service.remove(id, orgId, confirmName);
  }

  @Post(':id/sync')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Sync channel — import chats, contacts, and messages from provider' })
  syncChannel(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.syncChannel(id, orgId);
  }

  @Get(':id/sync/status')
  @ApiOperation({ summary: 'Get latest sync job status for a channel' })
  getSyncStatus(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.getSyncStatus(id, orgId);
  }

  @Post(':id/sync/cancel')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cancel active sync for a channel' })
  cancelSync(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.cancelSync(id, orgId);
  }

  @Post(':id/test')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Test channel connection' })
  testConnection(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.testConnection(id, orgId);
  }
}
