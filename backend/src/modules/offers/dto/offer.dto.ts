import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { OfferApprovalResult, OfferStatus } from '../../../constants/enums';

export class CreateOfferDto {
  @IsInt()
  candidateId!: number;

  @IsInt()
  jobId!: number;

  /** 年薪（元），低于 30 万仅需招聘经理审批，达到 30 万需经理 + 管理员两级审批 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salary!: number;

  @IsDateString()
  startDate!: string;

  @IsInt()
  approverId!: number;
}

export class UpdateOfferDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  salary?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class OfferStatusDto {
  @IsEnum(OfferStatus)
  status!: OfferStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  /** 乐观锁版本号：携带时服务端必须与当前版本一致，否则整次拒绝（同一条 Offer 并发保护） */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class OfferApprovalDto {
  @IsEnum(OfferApprovalResult)
  result!: OfferApprovalResult;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
