import { OfferApprovalNode as PrismaOfferApprovalNode, OfferApprovalStatus as PrismaOfferApprovalStatus, OfferStatus as PrismaOfferStatus } from '@prisma/client';

/** 单个审批层级记录 */
export class OfferApprovalItemDto {
  id: number;
  level: number;
  node: PrismaOfferApprovalNode;
  status: PrismaOfferApprovalStatus;
  deciderId: number | null;
  deciderName: string | null;
  salarySnapshot: string;
  reason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * Offer 操作统一响应：
 * - currentNode：当前所处节点（审批链中的下一个层级 / 状态节点 / COMPLETED）
 * - effectiveSalary：当前生效薪资（月薪，元）
 * - failureReason：失败原因（成功时为 null）
 */
export class OfferResultDto {
  id: number;
  candidateId: number;
  jobId: number;
  status: PrismaOfferStatus;
  version: number;
  salary: string;
  effectiveSalary: string;
  annualSalary: string;
  startDate: string;
  approverId: number | null;
  currentNode: string;
  requiredLevels: number;
  failureReason: string | null;
  reason: string | null;
  approvals: OfferApprovalItemDto[];
  candidate: unknown;
  job: unknown;
  approver: unknown;
}
