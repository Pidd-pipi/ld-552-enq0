import { Body, Controller, Get, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../../decorators/roles.decorator';
import { OfferApprovalResult, OfferStatus, UserRole } from '../../constants/enums';
import { CreateOfferDto, OfferApprovalDto, OfferStatusDto, UpdateOfferDto } from './dto/offer.dto';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private offers: OffersService) {}

  @Get()
  @Roles(UserRole.HR, UserRole.HIRING_MANAGER, UserRole.ADMIN)
  findAll() {
    return this.offers.findAll();
  }

  @Get(':id')
  @Roles(UserRole.HR, UserRole.HIRING_MANAGER, UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.offers.findOne(+id);
  }

  @Post()
  @Roles(UserRole.HR, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  create(@Body() body: CreateOfferDto) {
    return this.offers.create(body);
  }

  @Patch(':id')
  @Roles(UserRole.HR, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  update(@Param('id') id: string, @Body() body: UpdateOfferDto & { expectedVersion?: number }) {
    return this.offers.update(+id, body, body.expectedVersion);
  }

  /**
   * 分级审批：
   * - 招聘经理（HIRING_MANAGER）初审
   * - 年薪 >= 30 万时管理员（ADMIN）终审
   * 返回当前节点、生效薪资、失败原因
   */
  @Post(':id/approvals')
  @Roles(UserRole.HIRING_MANAGER, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  approve(@Param('id') id: string, @Body() body: OfferApprovalDto, @Req() req: any) {
    return this.offers.decide(+id, req.user, body.result as OfferApprovalResult, body.comment, body.expectedVersion);
  }

  /** 发送 / 接受 / 拒绝 / 撤回；发送前必须完成全部审批层级 */
  @Patch(':id/status')
  @Roles(UserRole.HR, UserRole.HIRING_MANAGER, UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  status(@Param('id') id: string, @Body() body: OfferStatusDto) {
    return this.offers.updateStatus(+id, body.status as OfferStatus, body.reason, body.expectedVersion);
  }
}
