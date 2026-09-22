import { Body, Controller, Param, Patch, Post, Get, Req } from '@nestjs/common';
import { Roles } from '../../decorators/roles.decorator';
import { UserRole } from '../../constants/enums';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { SubmitOfferDto } from './dto/submit-offer.dto';
import { ApproveOfferDto } from './dto/approve-offer.dto';
import { RejectApprovalDto } from './dto/reject-approval.dto';
import { OfferActionDto } from './dto/offer-action.dto';

@Controller('offers')
export class OffersController {
  constructor(private offers: OffersService) {}

  @Get(':id')
  @Roles(UserRole.HR, UserRole.HIRING_MANAGER, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.offers.findOne(+id);
  }

  @Post()
  @Roles(UserRole.HR, UserRole.ADMIN)
  create(@Body() body: CreateOfferDto) {
    return this.offers.create(body);
  }

  // 草稿改薪/改入职日期（仅 DRAFT，带版本号）
  @Patch(':id')
  @Roles(UserRole.HR, UserRole.ADMIN)
  update(@Param('id') id: string, @Body() body: UpdateOfferDto) {
    return this.offers.updateDraft(+id, body);
  }

  // 提交分级审批：年薪 < 30 万走经理一级；>= 30 万经理 + 管理员两级
  @Post(':id/submit')
  @Roles(UserRole.HR, UserRole.HIRING_MANAGER, UserRole.ADMIN)
  submit(@Param('id') id: string, @Body() body: SubmitOfferDto, @Req() req: any) {
    return this.offers.submit(+id, body.expectedVersion, req.user);
  }

  // 当前层级审批通过
  @Post(':id/approve')
  @Roles(UserRole.HIRING_MANAGER, UserRole.ADMIN)
  approve(@Param('id') id: string, @Body() body: ApproveOfferDto, @Req() req: any) {
    return this.offers.approve(+id, body, req.user);
  }

  // 当前层级驳回：整链终结，Offer 退回草稿
  @Post(':id/reject-approval')
  @Roles(UserRole.HIRING_MANAGER, UserRole.ADMIN)
  rejectApproval(@Param('id') id: string, @Body() body: RejectApprovalDto, @Req() req: any) {
    return this.offers.rejectApproval(+id, body, req.user);
  }

  // 发送 Offer：全部层级通过后才允许，简历转 OFFERED
  @Post(':id/send')
  @Roles(UserRole.HR, UserRole.ADMIN)
  send(@Param('id') id: string, @Body() body: OfferActionDto, @Req() req: any) {
    return this.offers.send(+id, body, req.user);
  }

  // 候选人接受：简历转 HIRED
  @Post(':id/accept')
  @Roles(UserRole.HR, UserRole.ADMIN)
  accept(@Param('id') id: string, @Body() body: OfferActionDto, @Req() req: any) {
    return this.offers.accept(+id, body, req.user);
  }

  // 候选人拒绝：简历恢复 INTERVIEWING
  @Post(':id/reject')
  @Roles(UserRole.HR, UserRole.ADMIN)
  reject(@Param('id') id: string, @Body() body: OfferActionDto, @Req() req: any) {
    return this.offers.rejectByCandidate(+id, body, req.user);
  }

  // 撤回已发送 Offer：简历恢复 INTERVIEWING
  @Post(':id/withdraw')
  @Roles(UserRole.HR, UserRole.ADMIN)
  withdraw(@Param('id') id: string, @Body() body: OfferActionDto, @Req() req: any) {
    return this.offers.withdraw(+id, body, req.user);
  }
}
