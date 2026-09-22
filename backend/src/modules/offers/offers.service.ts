import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, OfferApprovalNode as PrismaApprovalNode, OfferStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import {
  JobStatus,
  MONTHS_PER_YEAR,
  OFFER_SENIOR_APPROVAL_ANNUAL_THRESHOLD,
  OfferApprovalNode,
  OfferApprovalStatus,
  ResumeStatus,
  UserRole,
} from '../../constants/enums';
import { OfferBusinessException, OfferFailureReason } from '../../common/exceptions/offer.exceptions';
import { OfferApprovalItemDto, OfferResultDto } from './dto/offer-result.dto';

interface Actor {
  sub: number;
  role: UserRole;
  department?: string | null;
}

const offerInclude = {
  candidate: true,
  job: true,
  approver: { select: publicUserSelect },
  approvals: { orderBy: { level: 'asc' as const }, include: { decider: { select: publicUserSelect } } },
};

type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

/** 校验失败：携带失败原因直接整次拒绝 */
function fail(reason: OfferFailureReason, message: string): never {
  throw new OfferBusinessException(reason, message);
}

@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}

  // ---------- 查询 ----------

  async findOne(id: number): Promise<OfferResultDto> {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!offer) fail('OFFER_NOT_FOUND', `Offer #${id} 不存在`);
    return this.buildResult(offer, null, null);
  }

  // ---------- 创建草稿 ----------

  async create(data: { candidateId: number; jobId: number; salary: number; startDate: string }): Promise<OfferResultDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: data.jobId } });
      if (!job) fail('JOB_NOT_OPEN', `职位 #${data.jobId} 不存在，无法创建 Offer`);
      const candidate = await tx.candidate.findUnique({ where: { id: data.candidateId } });
      if (!candidate) fail('INVALID_OFFER_ACTION', `候选人 #${data.candidateId} 不存在`);
      return tx.offer.create({
        data: {
          candidateId: data.candidateId,
          jobId: data.jobId,
          salary: new Prisma.Decimal(data.salary),
          startDate: new Date(data.startDate),
          status: OfferStatus.DRAFT,
        },
        include: offerInclude,
      });
    });
    return this.buildResult(created, null, null);
  }

  // ---------- 修改草稿（薪资变化点） ----------

  async updateDraft(id: number, data: { salary?: number; startDate?: string; expectedVersion?: number }): Promise<OfferResultDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id);
      if (offer.status !== OfferStatus.DRAFT) {
        fail('INVALID_OFFER_ACTION', `仅草稿状态可修改，当前状态为 ${offer.status}`);
      }
      this.assertVersion(offer.version, data.expectedVersion);
      return tx.offer.update({
        where: { id },
        data: {
          salary: data.salary !== undefined ? new Prisma.Decimal(data.salary) : undefined,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          version: { increment: 1 },
        },
        include: offerInclude,
      });
    });
    return this.buildResult(updated, null, null);
  }

  // ---------- 提交分级审批 ----------

  async submit(id: number, expectedVersion: number | undefined, actor: Actor): Promise<OfferResultDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id);
      if (offer.status !== OfferStatus.DRAFT) {
        fail('INVALID_OFFER_ACTION', `仅草稿状态可提交审批，当前状态为 ${offer.status}`);
      }
      this.assertVersion(offer.version, expectedVersion);
      this.assertJobOpen(offer);
      this.assertManagerScope(offer, actor);

      const nodes = this.approvalNodes(offer.salary);
      // 整链一次性落库：任何一步失败整个事务回滚，不留半条审批记录
      await tx.offerApproval.deleteMany({ where: { offerId: id } });
      for (let level = 1; level <= nodes.length; level += 1) {
        await tx.offerApproval.create({
          data: {
            offerId: id,
            level,
            node: nodes[level - 1],
            status: OfferApprovalStatus.PENDING,
            salarySnapshot: offer.salary,
          },
        });
      }
      await tx.offer.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'Offer_APPROVAL_SUBMIT',
          entity: 'Offer',
          entityId: id,
          beforeStatus: OfferStatus.DRAFT,
          afterStatus: OfferStatus.DRAFT,
          reason: `提交 ${nodes.length} 级审批（年薪 ${this.annualSalary(offer.salary).toString()} 元）`,
          candidateId: offer.candidateId,
        },
      });
      return this.readOffer(tx, id);
    });
    return this.buildResult(result, null, null);
  }

  // ---------- 审批通过 ----------

  async approve(id: number, dto: { expectedVersion?: number; reason?: string }, actor: Actor): Promise<OfferResultDto> {
    const { offer, invalidReason } = await this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id);
      this.assertVersion(offer.version, dto.expectedVersion);

      const step = this.pendingStep(offer);
      if (!step) fail('INVALID_OFFER_ACTION', '该 Offer 当前没有待处理的审批层级');
      this.assertActorForNode(step.node, offer, actor);

      // 处理前重新核对岗位状态与薪资
      if (offer.job.status !== JobStatus.OPEN) {
        return { offer: await this.invalidateChain(tx, offer, actor, 'JOB_NOT_OPEN', '处理时发现职位已关闭'), invalidReason: 'JOB_NOT_OPEN' as const };
      }
      if (!step.salarySnapshot.eq(offer.salary)) {
        return { offer: await this.invalidateChain(tx, offer, actor, 'SALARY_CHANGED', '处理时发现薪资已变化'), invalidReason: 'SALARY_CHANGED' as const };
      }

      const now = new Date();
      await tx.offerApproval.update({
        where: { id: step.id },
        data: { status: OfferApprovalStatus.APPROVED, deciderId: actor.sub, reason: dto.reason, decidedAt: now },
      });
      const remaining = await tx.offerApproval.count({ where: { offerId: id, status: OfferApprovalStatus.PENDING } });
      if (remaining === 0) {
        // 全部层级完成：终审通过，Offer 进入 APPROVED，记录终审人
        await tx.offer.update({
          where: { id },
          data: { status: OfferStatus.APPROVED, approverId: actor.sub, version: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            action: 'Offer_APPROVED',
            entity: 'Offer',
            entityId: id,
            beforeStatus: OfferStatus.DRAFT,
            afterStatus: OfferStatus.APPROVED,
            reason: dto.reason ?? '分级审批全部通过',
            candidateId: offer.candidateId,
          },
        });
      } else {
        await tx.offer.update({ where: { id }, data: { version: { increment: 1 } } });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            action: 'Offer_APPROVAL_LEVEL_PASS',
            entity: 'Offer',
            entityId: id,
            beforeStatus: `LEVEL_${step.level}_PENDING`,
            afterStatus: `LEVEL_${step.level}_APPROVED`,
            reason: dto.reason,
            candidateId: offer.candidateId,
          },
        });
      }
      return { offer: await this.readOffer(tx, id), invalidReason: null };
    });
    if (invalidReason) {
      fail(invalidReason, invalidReason === 'JOB_NOT_OPEN' ? '职位已关闭，本次审批整次拒绝' : '薪资已变化，本次审批整次拒绝');
    }
    return this.buildResult(offer, null, null);
  }

  // ---------- 审批驳回（整链终结，不留半条） ----------

  async rejectApproval(id: number, dto: { reason: string; expectedVersion?: number }, actor: Actor): Promise<OfferResultDto> {
    const offer = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOffer(tx, id);
      this.assertVersion(locked.version, dto.expectedVersion);
      const step = this.pendingStep(locked);
      if (!step) fail('INVALID_OFFER_ACTION', '该 Offer 当前没有待处理的审批层级');
      this.assertActorForNode(step.node, locked, actor);

      const now = new Date();
      // 当前层级记驳回，其余待处理层级一并终结：审批记录不留下半条
      await tx.offerApproval.updateMany({
        where: { offerId: id, status: OfferApprovalStatus.PENDING },
        data: { status: OfferApprovalStatus.REJECTED, deciderId: actor.sub, decidedAt: now, reason: dto.reason },
      });
      await tx.offer.update({ where: { id }, data: { status: OfferStatus.DRAFT, version: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'Offer_APPROVAL_REJECTED',
          entity: 'Offer',
          entityId: id,
          beforeStatus: `LEVEL_${step.level}_PENDING`,
          afterStatus: OfferStatus.DRAFT,
          reason: dto.reason,
          candidateId: locked.candidateId,
        },
      });
      return this.readOffer(tx, id);
    });
    return this.buildResult(offer, null, dto.reason);
  }

  // ---------- 发送 Offer（未完成全部层级不得发送） ----------

  async send(id: number, dto: { expectedVersion?: number }, actor: Actor): Promise<OfferResultDto> {
    const { offer, invalidReason } = await this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id);
      this.assertVersion(offer.version, dto.expectedVersion);
      if (offer.status !== OfferStatus.APPROVED) {
        fail('INVALID_OFFER_ACTION', `未完成全部审批层级不得发送，当前状态为 ${offer.status}`);
      }
      const pending = offer.approvals.filter((a) => a.status === OfferApprovalStatus.PENDING);
      if (offer.approvals.length === 0 || pending.length > 0) {
        fail('INVALID_OFFER_ACTION', '审批层级未全部完成，不得发送 Offer');
      }

      // 发送前再次核对岗位状态与生效薪资
      if (offer.job.status !== JobStatus.OPEN) {
        return { offer: await this.invalidateChain(tx, offer, actor, 'JOB_NOT_OPEN', '发送时发现职位已关闭'), invalidReason: 'JOB_NOT_OPEN' as const };
      }
      const approvedSalary = offer.approvals[0].salarySnapshot;
      if (!approvedSalary.eq(offer.salary)) {
        return { offer: await this.invalidateChain(tx, offer, actor, 'SALARY_CHANGED', '发送时发现薪资与审批时不一致'), invalidReason: 'SALARY_CHANGED' as const };
      }

      // 简历必须处于面试中（候选人在该职位下的最新一条投递）
      const resume = await this.latestResume(tx, offer.candidateId, offer.jobId);
      if (!resume || resume.status !== ResumeStatus.INTERVIEWING) {
        fail('RESUME_NOT_INTERVIEWING', `候选人当前简历状态为 ${resume?.status ?? '无投递记录'}，需处于面试中才能发送 Offer`);
      }

      await tx.offer.update({ where: { id }, data: { status: OfferStatus.SENT, version: { increment: 1 } } });
      await tx.resume.update({ where: { id: resume.id }, data: { status: ResumeStatus.OFFERED } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'Offer_SENT',
          entity: 'Offer',
          entityId: id,
          beforeStatus: OfferStatus.APPROVED,
          afterStatus: OfferStatus.SENT,
          reason: '发送 Offer，简历转入已发 Offer',
          candidateId: offer.candidateId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'Resume_STATUS_CHANGE',
          entity: 'Resume',
          entityId: resume.id,
          beforeStatus: ResumeStatus.INTERVIEWING,
          afterStatus: ResumeStatus.OFFERED,
          reason: 'Offer 已发送',
          candidateId: offer.candidateId,
        },
      });
      return { offer: await this.readOffer(tx, id), invalidReason: null };
    });
    if (invalidReason) {
      fail(invalidReason, invalidReason === 'JOB_NOT_OPEN' ? '职位已关闭，Offer 整次拒绝发送' : '薪资已变化，Offer 整次拒绝发送');
    }
    return this.buildResult(offer, null, null);
  }

  // ---------- 候选人接受：简历转已录用 ----------

  async accept(id: number, dto: { expectedVersion?: number; reason?: string }, actor: Actor): Promise<OfferResultDto> {
    const offer = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOffer(tx, id);
      this.assertVersion(locked.version, dto.expectedVersion);
      if (locked.status !== OfferStatus.SENT) fail('INVALID_OFFER_ACTION', `仅已发送的 Offer 可被接受，当前状态为 ${locked.status}`);

      const resume = await this.latestResume(tx, locked.candidateId, locked.jobId);
      if (!resume) fail('RESUME_NOT_INTERVIEWING', '未找到候选人在该职位下的投递记录');
      await tx.offer.update({ where: { id }, data: { status: OfferStatus.ACCEPTED, version: { increment: 1 } } });
      await tx.resume.update({ where: { id: resume.id }, data: { status: ResumeStatus.HIRED } });
      await tx.auditLog.create({
        data: { actorId: actor.sub, action: 'Offer_ACCEPTED', entity: 'Offer', entityId: id, beforeStatus: OfferStatus.SENT, afterStatus: OfferStatus.ACCEPTED, reason: dto.reason, candidateId: locked.candidateId },
      });
      await tx.auditLog.create({
        data: { actorId: actor.sub, action: 'Resume_STATUS_CHANGE', entity: 'Resume', entityId: resume.id, beforeStatus: ResumeStatus.OFFERED, afterStatus: ResumeStatus.HIRED, reason: '候选人接受 Offer', candidateId: locked.candidateId },
      });
      return this.readOffer(tx, id);
    });
    return this.buildResult(offer, null, dto.reason ?? null);
  }

  // ---------- 候选人拒绝：简历恢复面试中 ----------

  async rejectByCandidate(id: number, dto: { reason?: string; expectedVersion?: number }, actor: Actor): Promise<OfferResultDto> {
    const offer = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOffer(tx, id);
      this.assertVersion(locked.version, dto.expectedVersion);
      if (locked.status !== OfferStatus.SENT) fail('INVALID_OFFER_ACTION', `仅已发送的 Offer 可被拒绝，当前状态为 ${locked.status}`);
      const resume = await this.latestResume(tx, locked.candidateId, locked.jobId);
      await tx.offer.update({ where: { id }, data: { status: OfferStatus.REJECTED, version: { increment: 1 } } });
      if (resume && resume.status === ResumeStatus.OFFERED) {
        await tx.resume.update({ where: { id: resume.id }, data: { status: ResumeStatus.INTERVIEWING } });
      }
      await tx.auditLog.create({
        data: { actorId: actor.sub, action: 'Offer_REJECTED', entity: 'Offer', entityId: id, beforeStatus: OfferStatus.SENT, afterStatus: OfferStatus.REJECTED, reason: dto.reason, candidateId: locked.candidateId },
      });
      if (resume) {
        await tx.auditLog.create({
          data: { actorId: actor.sub, action: 'Resume_STATUS_CHANGE', entity: 'Resume', entityId: resume.id, beforeStatus: ResumeStatus.OFFERED, afterStatus: ResumeStatus.INTERVIEWING, reason: '候选人拒绝 Offer', candidateId: locked.candidateId },
        });
      }
      return this.readOffer(tx, id);
    });
    return this.buildResult(offer, null, dto.reason ?? null);
  }

  // ---------- 撤回：简历恢复面试中 ----------

  async withdraw(id: number, dto: { reason?: string; expectedVersion?: number }, actor: Actor): Promise<OfferResultDto> {
    const offer = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOffer(tx, id);
      this.assertVersion(locked.version, dto.expectedVersion);
      if (locked.status !== OfferStatus.SENT) fail('INVALID_OFFER_ACTION', `仅已发送的 Offer 可撤回，当前状态为 ${locked.status}`);
      const resume = await this.latestResume(tx, locked.candidateId, locked.jobId);
      await tx.offer.update({ where: { id }, data: { status: OfferStatus.WITHDRAWN, version: { increment: 1 } } });
      if (resume && resume.status === ResumeStatus.OFFERED) {
        await tx.resume.update({ where: { id: resume.id }, data: { status: ResumeStatus.INTERVIEWING } });
      }
      await tx.auditLog.create({
        data: { actorId: actor.sub, action: 'Offer_WITHDRAWN', entity: 'Offer', entityId: id, beforeStatus: OfferStatus.SENT, afterStatus: OfferStatus.WITHDRAWN, reason: dto.reason, candidateId: locked.candidateId },
      });
      if (resume) {
        await tx.auditLog.create({
          data: { actorId: actor.sub, action: 'Resume_STATUS_CHANGE', entity: 'Resume', entityId: resume.id, beforeStatus: ResumeStatus.OFFERED, afterStatus: ResumeStatus.INTERVIEWING, reason: 'Offer 撤回', candidateId: locked.candidateId },
        });
      }
      return this.readOffer(tx, id);
    });
    return this.buildResult(offer, null, dto.reason ?? null);
  }

  // ---------- 内部工具 ----------

  /** 行级锁定 Offer 并带出审批链与职位，防止同一条 Offer 并发处理 */
  private async lockOffer(tx: Prisma.TransactionClient, id: number): Promise<OfferWithRelations> {
    const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`SELECT id FROM "Offer" WHERE id = ${id} FOR UPDATE`);
    if (locked.length === 0) fail('OFFER_NOT_FOUND', `Offer #${id} 不存在`);
    return this.readOffer(tx, id);
  }

  private readOffer(tx: Prisma.TransactionClient, id: number): Promise<OfferWithRelations> {
    return tx.offer.findUniqueOrThrow({ where: { id }, include: offerInclude });
  }

  private assertVersion(current: number, expected?: number) {
    if (expected !== undefined && expected !== current) {
      fail('OFFER_CONCURRENT_MODIFICATION', `Offer 已被并发修改（版本 ${current} 与期望版本 ${expected} 不一致），整次拒绝`);
    }
  }

  private assertJobOpen(offer: OfferWithRelations) {
    if (offer.job.status !== JobStatus.OPEN) {
      fail('JOB_NOT_OPEN', `职位「${offer.job.title}」当前状态为 ${offer.job.status}，未处于招聘开放状态`);
    }
  }

  /** 招聘经理只能处理本部门职位的 Offer；管理员不限 */
  private assertManagerScope(offer: OfferWithRelations, actor: Actor) {
    if (actor.role === UserRole.HIRING_MANAGER && actor.department !== offer.job.department) {
      throw new ForbiddenException('只能处理本部门职位的 Offer');
    }
  }

  /** 节点角色校验：经理节点限招聘经理（本部门）/管理员；管理员节点仅管理员 */
  private assertActorForNode(node: PrismaApprovalNode, offer: OfferWithRelations, actor: Actor) {
    if (actor.role === UserRole.ADMIN) return;
    if (node === OfferApprovalNode.HIRING_MANAGER) {
      if (actor.role !== UserRole.HIRING_MANAGER) {
        fail('APPROVAL_FORBIDDEN', '当前审批节点需要招聘经理处理');
      }
      this.assertManagerScope(offer, actor);
      return;
    }
    fail('APPROVAL_FORBIDDEN', '当前审批节点需要管理员终审');
  }

  private pendingStep(offer: OfferWithRelations) {
    return offer.approvals.find((a) => a.status === OfferApprovalStatus.PENDING) ?? null;
  }

  /**
   * 审批链中发现职位关闭 / 薪资变化：整次拒绝。
   * 所有未决层级一次性终结为 REJECTED，Offer 回到草稿，不存在悬挂的半条记录。
   */
  private async invalidateChain(
    tx: Prisma.TransactionClient,
    offer: OfferWithRelations,
    actor: Actor,
    reasonCode: 'JOB_NOT_OPEN' | 'SALARY_CHANGED',
    reasonText: string,
  ): Promise<OfferWithRelations> {
    const step = this.pendingStep(offer);
    const now = new Date();
    await tx.offerApproval.updateMany({
      where: { offerId: offer.id, status: OfferApprovalStatus.PENDING },
      data: { status: OfferApprovalStatus.REJECTED, deciderId: actor.sub, decidedAt: now, reason: reasonText },
    });
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.DRAFT, approverId: null, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        action: reasonCode === 'JOB_NOT_OPEN' ? 'Offer_APPROVAL_JOB_CLOSED' : 'Offer_APPROVAL_SALARY_CHANGED',
        entity: 'Offer',
        entityId: offer.id,
        beforeStatus: step ? `LEVEL_${step.level}_PENDING` : offer.status,
        afterStatus: OfferStatus.DRAFT,
        reason: reasonText,
        candidateId: offer.candidateId,
      },
    });
    return this.readOffer(tx, offer.id);
  }

  private async latestResume(
    tx: Prisma.TransactionClient,
    candidateId: number,
    jobId: number,
  ): Promise<{ id: number; status: ResumeStatus } | null> {
    const rows = await tx.$queryRaw<Array<{ id: number; status: ResumeStatus }>>(Prisma.sql`
      SELECT id, status::text AS status FROM "Resume"
      WHERE "candidateId" = ${candidateId} AND "jobId" = ${jobId}
      ORDER BY "submittedAt" DESC, id DESC LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /** 薪资分级：年薪 < 30 万仅经理一级；>= 30 万经理先批、管理员终审 */
  private approvalNodes(salary: Prisma.Decimal): OfferApprovalNode[] {
    const annual = this.annualSalary(salary);
    if (annual.gte(OFFER_SENIOR_APPROVAL_ANNUAL_THRESHOLD)) {
      return [OfferApprovalNode.HIRING_MANAGER, OfferApprovalNode.ADMIN];
    }
    return [OfferApprovalNode.HIRING_MANAGER];
  }

  private annualSalary(monthly: Prisma.Decimal): Prisma.Decimal {
    return new Prisma.Decimal(monthly).mul(MONTHS_PER_YEAR);
  }

  // ---------- 响应组装：当前节点 / 生效薪资 / 失败原因 ----------

  private buildResult(offer: OfferWithRelations, failureReason: string | null, reason: string | null): OfferResultDto {
    const approvals: OfferApprovalItemDto[] = offer.approvals.map((a) => ({
      id: a.id,
      level: a.level,
      node: a.node,
      status: a.status,
      deciderId: a.deciderId,
      deciderName: a.decider?.name ?? null,
      salarySnapshot: a.salarySnapshot.toString(),
      reason: a.reason,
      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    }));
    return {
      id: offer.id,
      candidateId: offer.candidateId,
      jobId: offer.jobId,
      status: offer.status,
      version: offer.version,
      salary: offer.salary.toString(),
      effectiveSalary: offer.salary.toString(),
      annualSalary: this.annualSalary(offer.salary).toString(),
      startDate: offer.startDate.toISOString(),
      approverId: offer.approverId,
      currentNode: this.currentNode(offer),
      requiredLevels: this.approvalNodes(offer.salary).length,
      failureReason,
      reason,
      approvals,
      candidate: offer.candidate,
      job: offer.job,
      approver: offer.approver ?? null,
    };
  }

  private currentNode(offer: OfferWithRelations): string {
    const pending = offer.approvals.find((a) => a.status === OfferApprovalStatus.PENDING);
    if (pending) return pending.node === OfferApprovalNode.HIRING_MANAGER ? `HIRING_MANAGER_APPROVAL_LEVEL_${pending.level}` : `ADMIN_FINAL_APPROVAL_LEVEL_${pending.level}`;
    switch (offer.status) {
      case OfferStatus.DRAFT:
        return offer.approvals.some((a) => a.status === OfferApprovalStatus.REJECTED) ? 'APPROVAL_REJECTED' : 'DRAFT_PENDING_SUBMIT';
      case OfferStatus.APPROVED:
        return 'APPROVED_PENDING_SEND';
      case OfferStatus.SENT:
        return 'SENT_PENDING_CANDIDATE_DECISION';
      case OfferStatus.ACCEPTED:
        return 'COMPLETED_ACCEPTED';
      case OfferStatus.REJECTED:
        return 'COMPLETED_REJECTED';
      case OfferStatus.WITHDRAWN:
        return 'COMPLETED_WITHDRAWN';
      default:
        return offer.status;
    }
  }
}
