import { HttpException, HttpStatus } from '@nestjs/common';

/** Offer 业务失败原因码，接口统一通过 failureReason 返回 */
export type OfferFailureReason =
  | 'OFFER_NOT_FOUND'
  | 'JOB_CLOSED'
  | 'SALARY_CHANGED'
  | 'CONCURRENT_MODIFICATION'
  | 'INVALID_TRANSITION'
  | 'APPROVAL_LEVEL_LOCKED'
  | 'APPROVAL_ALREADY_PROCESSED'
  | 'APPROVAL_LEVEL_SKIPPED'
  | 'APPROVAL_PERMISSION_DENIED'
  | 'NOT_FULLY_APPROVED';

export class OfferBusinessException extends HttpException {
  constructor(
    public readonly failureReason: OfferFailureReason,
    message: string,
    status: HttpStatus = HttpStatus.CONFLICT,
  ) {
    super({ statusCode: status, message, error: 'OfferBusinessError', failureReason }, status);
  }
}

export class OfferNotFoundException extends OfferBusinessException {
  constructor() {
    super('OFFER_NOT_FOUND', 'Offer 不存在', HttpStatus.NOT_FOUND);
  }
}
