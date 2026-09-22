import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import {
  ApprovalLevel,
  OfferApprovalResult,
  OfferStatus,
  ResumeStatus,
  TIERED_APPROVAL_SALARY_THRESHOLD,
  UserRole,
} from '../../constants/enums';
import { OfferBusinessException, OfferFailureReason, OfferNotFoundException } from '../../common/exceptions/offer.exceptions';

/** Offer 写操作后的统一返回结构：当前节点 / 生效薪资 / 失败原因 */
export interface OfferActionResult {
  id: number;
  status: OfferStatus;
  currentNode: string;
  effectiveSalary: string;
  failureReason: OfferFailureReason | null;
  [key: string]: unknown;
}

/** 允许的 Offer 状态流转（审批通过/驳回由专用审批接口处理，不走通用状态接口） */
const flow: Record<OfferStatus, OfferStatus[]> = {
  [OfferStatus.DRAFT]: [],
  [OfferStatus.PENDING_APPROVAL]: [OfferStatus.REJECTED],
  [OfferStatus.APPROVED]: [OfferStatus.SENT, OfferStatus.REJECTED],
  [OfferStatus.SENT]: [OfferStatus.ACCEPTED, OfferStatus.REJECTED, OfferStatus.WITHDRAWN],
  [OfferStatus.ACCEPTED]: [],
  [OfferStatus.REJECTED]: [],
  [OfferStatus.WITHDRAWN]: [],
};

const offerInclude = {
  candidate: true,
  job: true,
  approver: { select: publicUserSelect },
  approvals: { orderBy: { createdAt: 'asc' }, include: { approver: { select: publicUserSelect } } },
} satisfies Prisma.OfferInclude;

type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;
/** 跨 Prisma 枚举与 constants 枚举边界：二者取值一致 */
type OfferRow = Omit<OfferWithRelations, 'status'> & { status: OfferStatus };

@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}

  // ---------- 查询 ----------

  findAll() {
    return this.prisma.offer.findMany({ include: offerInclude, orderBy: { updatedAt: 'desc' } });
  }

  async findOne(id: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!offer) throw new OfferNotFoundException();
    return this.serialize(offer);
  }

  // ---------- 创建 / 编辑 ----------

  async create(data: { candidateId: number; jobId: number; salary: number | string; startDate: string; approverId: number }) {
    const offer = await this.prisma.offer.create({
      data: {
        candidateId: data.candidateId,
        jobId: data.jobId,
        salary: new Prisma.Decimal(data.salary),
        startDate: new Date(data.startDate),
        status: OfferStatus.DRAFT,
        approverId: data.approverId,
        version: 1,
      },
      include: offerInclude,
    });
    return this.serialize(offer);
  }

  /** 编辑薪资/入职日期：仅草稿允许；每次编辑递增版本号，处理时会重新核对薪资 */
  async update(id: number, data: { salary?: number; startDate?: string }, expectedVersion?: number) {
    return this.withOfferLock(id, async (tx, offer) => {
      if (offer.status !== OfferStatus.DRAFT) {
        throw new OfferBusinessException('INVALID_TRANSITION', `审批已发起（${offer.status}），不可修改 Offer，请驳回后重新创建`);
      }
      const updated = await tx.offer.update({
        where: { id },
        data: {
          salary: data.salary !== undefined ? new Prisma.Decimal(data.salary) : undefined,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          version: { increment: 1 },
        },
        include: offerInclude,
      });
      return this.serialize(updated, offer.status);
    }, expectedVersion);
  }

  // ---------- 分级审批 ----------

  /**
   * 分级审批：
   * - 年薪 < 30 万：招聘经理单级审批
   * - 年薪 >= 30 万：招聘经理初审 -> 管理员终审
   * 整个处理（岗位状态/薪资/并发复核 + 审批记录写入 + 状态变更）在一个事务内完成，失败不留半条记录。
   */
  async decide(
    id: number,
    user: { sub: number; role: UserRole },
    result: OfferApprovalResult,
    comment: string | undefined,
    expectedVersion?: number,
  ): Promise<OfferActionResult> {
    return this.withOfferLock(id, async (tx, offer) => {
      // 角色 -> 审批层级
      const level = this.roleToLevel(user.role);
      if (!level) throw new ForbiddenException('当前角色无权审批 Offer');

      if (![OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL].includes(offer.status)) {
        throw new OfferBusinessException('INVALID_TRANSITION', `Offer 当前状态 ${offer.status} 不可审批`);
      }

      // 以审批链启动时（首条审批记录）的薪资快照确定分级与生效薪资
      const snapSalary = this.chainSalary(offer);
      const requiredLevels = this.requiredLevels(snapSalary);
      const approvedLevels = offer.approvals
        .filter((a) => a.result === OfferApprovalResult.APPROVED)
        .map((a) => a.level);

      // 同一层级重复审批（含并发场景）：整次拒绝
      if (offer.approvals.some((a) => a.level === level)) {
        throw new OfferBusinessException('APPROVAL_ALREADY_PROCESSED', `${this.levelText(level)} 层级已审批，请勿重复操作`);
      }

      // 必须按层级顺序：经理先批，高薪 Offer 管理员才能终审
      const pendingIndex = requiredLevels.findIndex((l) => !approvedLevels.includes(l));
      const pendingLevel = requiredLevels[pendingIndex];
      if (level !== pendingLevel) {
        throw new OfferBusinessException(
          'APPROVAL_LEVEL_SKIPPED',
          pendingLevel === ApprovalLevel.HIRING_MANAGER ? '需招聘经理先审批' : '招聘经理已审批，等待管理员终审，不可越级',
        );
      }

      // 驳回：写入一条 REJECTED 记录并终止流程
      if (result === OfferApprovalResult.REJECTED) {
        await tx.offerApproval.create({
          data: { offerId: id, level, result: OfferApprovalResult.REJECTED, approverId: user.sub, comment, salarySnap: snapSalary },
        });
        const rejected = await tx.offer.update({
          where: { id },
          data: {
            status: OfferStatus.REJECTED,
            approverId: user.sub,
            effectiveSalary: null,
            version: { increment: 1 },
          },
          include: offerInclude,
        });
        return this.serialize(rejected, offer.status);
      }

      // 通过：写入本层级记录；全部层级完成才置为 APPROVED（否则保持 PENDING_APPROVAL）
      await tx.offerApproval.create({
        data: { offerId: id, level, result: OfferApprovalResult.APPROVED, approverId: user.sub, comment, salarySnap: snapSalary },
      });
      const newApproved = [...approvedLevels, level];
      const allApproved = requiredLevels.every((l) => newApproved.includes(l));
      const updated = await tx.offer.update({
        where: { id },
        data: {
          status: allApproved ? OfferStatus.APPROVED : OfferStatus.PENDING_APPROVAL,
          approverId: user.sub,
          effectiveSalary: allApproved ? snapSalary : null,
          version: { increment: 1 },
        },
        include: offerInclude,
      });
      return this.serialize(updated, offer.status);
    }, expectedVersion);
  }

  // ---------- 发送 / 接受 / 拒绝 / 撤回 ----------

  async updateStatus(id: number, status: OfferStatus, reason?: string, expectedVersion?: number): Promise<OfferActionResult> {
    if (status === OfferStatus.APPROVED) {
      throw new OfferBusinessException('INVALID_TRANSITION', '审批必须通过分级审批接口完成，不可直接置为 APPROVED');
    }
    return this.withOfferLock(id, async (tx, offer) => {
      if (!flow[offer.status].includes(status)) {
        // 仍在审批链上却尝试发送：明确提示未完成全部层级，其余按非法流转拒绝
        if (status === OfferStatus.SENT && [OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL].includes(offer.status)) {
          throw new OfferBusinessException('NOT_FULLY_APPROVED', '未完成全部审批层级，不能发送 Offer');
        }
        throw new OfferBusinessException('INVALID_TRANSITION', `非法 Offer 状态流转: ${offer.status} -> ${status}`);
      }

      // 发送前强制复核：岗位状态、薪资、全部审批层级
      if (status === OfferStatus.SENT) {
        const snapSalary = this.chainSalary(offer);
        const requiredLevels = this.requiredLevels(snapSalary);
        const fullyApproved =
          offer.approvals.filter((a) => a.result === OfferApprovalResult.APPROVED).length === requiredLevels.length;
        if (!fullyApproved) {
          throw new OfferBusinessException('NOT_FULLY_APPROVED', '存在未完成的审批层级，不能发送 Offer');
        }
      }

      const updated = await tx.offer.update({
        where: { id },
        data: { status, version: { increment: 1 } },
        include: offerInclude,
      });

      // 简历联动
      await this.syncResume(tx, offer.candidateId, offer.jobId, status);

      return this.serialize(updated, offer.status, reason);
    }, expectedVersion);
  }

  /** 发送 -> 简历 OFFERED；接受 -> HIRED；候选人拒绝 / HR 撤回 -> 恢复 INTERVIEWING */
  private async syncResume(tx: Prisma.TransactionClient, candidateId: number, jobId: number, offerStatus: OfferStatus) {
    const resume = await tx.resume.findFirst({ where: { candidateId, jobId }, orderBy: { updatedAt: 'desc' } });
    if (!resume) return;
    let next: ResumeStatus | null = null;
    if (offerStatus === OfferStatus.SENT && resume.status === ResumeStatus.INTERVIEWING) next = ResumeStatus.OFFERED;
    else if (offerStatus === OfferStatus.ACCEPTED && resume.status === ResumeStatus.OFFERED) next = ResumeStatus.HIRED;
    else if ((offerStatus === OfferStatus.REJECTED || offerStatus === OfferStatus.WITHDRAWN) && resume.status === ResumeStatus.OFFERED) {
      next = ResumeStatus.INTERVIEWING;
    }
    if (next) await tx.resume.update({ where: { id: resume.id }, data: { status: next } });
  }

  // ---------- 事务与复核 ----------

  /**
   * 同一条 Offer 的所有写操作串行化：
   * 1. 事务内对该 Offer 加事务级咨询锁（并发请求整次拒绝，不产生任何中间写入）
   * 2. 重新核对岗位状态（CLOSED/ARCHIVED 整次拒绝）
   * 3. 重新核对薪资（与审批链薪资快照不一致整次拒绝）
   * 4. 乐观版本号校验（客户端携带 expectedVersion 时）
   */
  private async withOfferLock<T>(
    id: number,
    fn: (tx: Prisma.TransactionClient, offer: OfferRow) => Promise<T>,
    expectedVersion?: number,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // 单 bigint key：高 32 位为本业务锁命名空间 5520，低 32 位为 Offer ID
      await tx.$executeRaw`SELECT pg_advisory_xact_lock((5520::bigint << 32) | ${id}::bigint)`;
      const offer = (await tx.offer.findUnique({ where: { id }, include: offerInclude })) as OfferRow | null;
      if (!offer) throw new OfferNotFoundException();

      const job = await tx.job.findUnique({ where: { id: offer.jobId } });
      if (job && [OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL, OfferStatus.APPROVED].includes(offer.status) &&
        ['CLOSED', 'ARCHIVED'].includes(job.status)) {
        throw new OfferBusinessException('JOB_CLOSED', `职位已${job.status === 'CLOSED' ? '关闭' : '归档'}，本次操作整次拒绝`);
      }

      // 审批链已启动后薪资发生变化：任何后续处理整次拒绝
      const snap = this.chainSalary(offer);
      if (offer.approvals.length > 0 && snap !== offer.salary.toFixed(2)) {
        throw new OfferBusinessException('SALARY_CHANGED', `薪资已由 ${snap} 变更为 ${offer.salary.toFixed(2)}，请重新发起审批`);
      }

      if (expectedVersion !== undefined && offer.version !== expectedVersion) {
        throw new OfferBusinessException(
          'CONCURRENT_MODIFICATION',
          `Offer 已被其他操作更新（版本 ${offer.version}），请刷新后重试`,
        );
      }

      return fn(tx, offer);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  // ---------- 规则与组装 ----------

  private roleToLevel(role: UserRole): ApprovalLevel | null {
    if (role === UserRole.HIRING_MANAGER) return ApprovalLevel.HIRING_MANAGER;
    if (role === UserRole.ADMIN) return ApprovalLevel.ADMIN;
    return null;
  }

  /** 按年薪确定所需审批层级：>= 30 万两级，其余单级 */
  private requiredLevels(salary: Prisma.Decimal | string): ApprovalLevel[] {
    const amount = typeof salary === 'string' ? new Prisma.Decimal(salary) : salary;
    return amount.greaterThanOrEqualTo(TIERED_APPROVAL_SALARY_THRESHOLD)
      ? [ApprovalLevel.HIRING_MANAGER, ApprovalLevel.ADMIN]
      : [ApprovalLevel.HIRING_MANAGER];
  }

  /** 审批链薪资快照（首条审批记录时的年薪）；链未启动则取当前薪资 */
  private chainSalary(offer: OfferWithRelations): string {
    const first = offer.approvals[0];
    return (first ? first.salarySnap : offer.salary).toFixed(2);
  }

  private currentNode(offer: OfferWithRelations): string {
    switch (offer.status) {
      case OfferStatus.DRAFT:
        return 'DRAFT';
      case OfferStatus.PENDING_APPROVAL: {
        const snapSalary = this.chainSalary(offer);
        const required = this.requiredLevels(snapSalary);
        const approved = offer.approvals.filter((a) => a.result === OfferApprovalResult.APPROVED).map((a) => a.level);
        const pending = required.find((l) => !approved.includes(l));
        return pending ? `PENDING_${pending}` : OfferStatus.APPROVED;
      }
      default:
        return offer.status;
    }
  }

  private levelText(level: ApprovalLevel): string {
    return level === ApprovalLevel.HIRING_MANAGER ? '招聘经理' : '管理员';
  }

  private serialize(offer: OfferWithRelations, beforeStatus?: OfferStatus, reason?: string): OfferActionResult {
    const row = offer as unknown as OfferRow;
    return {
      ...row,
      salary: row.salary.toFixed(2),
      effectiveSalary: (row.effectiveSalary ?? row.salary).toFixed(2),
      currentNode: this.currentNode(row),
      failureReason: null,
      beforeStatus,
      reason,
      candidateId: row.candidateId,
    } as unknown as OfferActionResult;
  }
}
