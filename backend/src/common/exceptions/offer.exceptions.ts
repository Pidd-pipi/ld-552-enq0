import { HttpException, HttpStatus } from '@nestjs/common';

export type OfferFailureReason =
  | 'JOB_NOT_OPEN'
  | 'SALARY_CHANGED'
  | 'OFFER_CONCURRENT_MODIFICATION'
  | 'OFFER_NOT_FOUND'
  | 'INVALID_OFFER_ACTION'
  | 'APPROVAL_LEVEL_MISMATCH'
  | 'APPROVAL_FORBIDDEN'
  | 'RESUME_NOT_INTERVIEWING';

const httpStatusMap: Record<OfferFailureReason, HttpStatus> = {
  JOB_NOT_OPEN: HttpStatus.CONFLICT,
  SALARY_CHANGED: HttpStatus.CONFLICT,
  OFFER_CONCURRENT_MODIFICATION: HttpStatus.CONFLICT,
  OFFER_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_OFFER_ACTION: HttpStatus.BAD_REQUEST,
  APPROVAL_LEVEL_MISMATCH: HttpStatus.CONFLICT,
  APPROVAL_FORBIDDEN: HttpStatus.FORBIDDEN,
  RESUME_NOT_INTERVIEWING: HttpStatus.CONFLICT,
};

/**
 * Offer 分级审批业务异常。
 * failureReason 为机器可读的失败原因，随接口响应一并返回。
 */
export class OfferBusinessException extends HttpException {
  readonly failureReason: OfferFailureReason;

  constructor(failureReason: OfferFailureReason, message: string) {
    super(
      { statusCode: httpStatusMap[failureReason], message, failureReason, error: 'OfferBusinessError' },
      httpStatusMap[failureReason],
    );
    this.failureReason = failureReason;
  }
}
