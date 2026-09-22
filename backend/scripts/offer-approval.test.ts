import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { OffersService } from '../src/modules/offers/offers.service';
import { OfferBusinessException } from '../src/common/exceptions/offer.exceptions';
import { JobStatus, OfferStatus, OfferApprovalResult, ResumeStatus, UserRole } from '../src/constants/enums';

const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const svc = new OffersService(prisma as any);

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };
const expectFail = async (reason: string, name: string, fn: () => Promise<any>) => {
  try { await fn(); fail++; console.log('  ❌', name, '(未拒绝)'); }
  catch (e: any) {
    if (e instanceof OfferBusinessException && e.failureReason === reason) { pass++; console.log('  ✅', name, `(${reason})`); }
    else { fail++; console.log('  ❌', name, '实际异常:', e.failureReason || e.message); }
  }
};

async function seed() {
  await prisma.offerApproval.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.resume.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
  const hash = await bcrypt.hash('pw', 4);
  const manager = await prisma.user.create({ data: { name: '经理', email: 'm@t.io', passwordHash: hash, role: UserRole.HIRING_MANAGER, department: 'RD' } });
  const admin = await prisma.user.create({ data: { name: '管理员', email: 'a@t.io', passwordHash: hash, role: UserRole.ADMIN } });
  const hr = await prisma.user.create({ data: { name: 'HR', email: 'h@t.io', passwordHash: hash, role: UserRole.HR, department: 'RD' } });
  const job = await prisma.job.create({ data: { title: '工程师', department: 'RD', location: 'SH', salaryRange: '1-2', description: 'd', requirements: 'r', headcount: 1, status: JobStatus.OPEN, hiringManagerId: manager.id } });
  const candidate = await prisma.candidate.create({ data: { name: '张三', email: 'z@t.io', source: '内推' } });
  const resume = await prisma.resume.create({ data: { candidateId: candidate.id, jobId: job.id, resumeUrl: 'u', status: ResumeStatus.INTERVIEWING } });
  return { manager, admin, hr, job, candidate, resume };
}

async function main() {
  const ctx = await seed();

  // ---------- 场景1：低薪 Offer（<30万）经理单级审批 ----------
  console.log('\n场景1: 年薪 25 万，经理单级审批 -> 发送 -> 接受');
  let o: any = await svc.create({ candidateId: ctx.candidate.id, jobId: ctx.job.id, salary: 250000, startDate: '2026-12-01', approverId: ctx.manager.id });
  ok(o.status === OfferStatus.DRAFT && o.currentNode === 'DRAFT' && o.failureReason === null, '创建后为 DRAFT');
  await expectFail('APPROVAL_LEVEL_SKIPPED', '管理员不可越过经理首审', () =>
    svc.decide(o.id, { sub: ctx.admin.id, role: UserRole.ADMIN }, OfferApprovalResult.APPROVED));
  o = await svc.decide(o.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED);
  ok(o.status === OfferStatus.APPROVED && o.currentNode === 'APPROVED' && o.effectiveSalary === '250000.00', '经理单级审批后直接 APPROVED，生效薪资 250000.00');
  o = await svc.updateStatus(o.id, OfferStatus.SENT);
  ok(o.status === OfferStatus.SENT, '已发送');
  const r1 = await prisma.resume.findUnique({ where: { id: ctx.resume.id } });
  ok(r1!.status === ResumeStatus.OFFERED, '发送后简历转为 OFFERED');
  o = await svc.updateStatus(o.id, OfferStatus.ACCEPTED);
  const r1b = await prisma.resume.findUnique({ where: { id: ctx.resume.id } });
  ok(o.status === OfferStatus.ACCEPTED && r1b!.status === ResumeStatus.HIRED, '接受后 Offer ACCEPTED / 简历 HIRED');

  // ---------- 场景2：高薪 Offer（>=30万）两级审批 ----------
  console.log('\n场景2: 年薪 30 万，经理初审 + 管理员终审');
  await prisma.resume.update({ where: { id: ctx.resume.id }, data: { status: ResumeStatus.INTERVIEWING } });
  let o2: any = await svc.create({ candidateId: ctx.candidate.id, jobId: ctx.job.id, salary: 300000, startDate: '2026-12-01', approverId: ctx.manager.id });
  o2 = await svc.decide(o2.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED);
  ok(o2.status === OfferStatus.PENDING_APPROVAL && o2.currentNode === 'PENDING_ADMIN', '经理批后 PENDING_APPROVAL，当前节点 PENDING_ADMIN');
  await expectFail('NOT_FULLY_APPROVED', '未完成全部层级不能发送', () => svc.updateStatus(o2.id, OfferStatus.SENT));
  await expectFail('APPROVAL_ALREADY_PROCESSED', '经理不可重复审批', () =>
    svc.decide(o2.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED));
  o2 = await svc.decide(o2.id, { sub: ctx.admin.id, role: UserRole.ADMIN }, OfferApprovalResult.APPROVED);
  ok(o2.status === OfferStatus.APPROVED && o2.effectiveSalary === '300000.00', '管理员终审后 APPROVED，生效薪资 300000.00');
  const recs = await prisma.offerApproval.findMany({ where: { offerId: o2.id } });
  ok(recs.length === 2, '审批记录恰好 2 条（经理 + 管理员）');
  o2 = await svc.updateStatus(o2.id, OfferStatus.SENT);
  ok(o2.status === OfferStatus.SENT, '两级完成后可发送');

  // ---------- 场景3：候选人拒绝 / 撤回恢复 INTERVIEWING ----------
  console.log('\n场景3: 拒绝恢复 INTERVIEWING');
  const c3 = await prisma.candidate.create({ data: { name: '李四', email: 'l@t.io', source: '官网' } });
  const r3 = await prisma.resume.create({ data: { candidateId: c3.id, jobId: ctx.job.id, resumeUrl: 'u', status: ResumeStatus.INTERVIEWING } });
  let o3: any = await svc.create({ candidateId: c3.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  o3 = await svc.decide(o3.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED);
  o3 = await svc.updateStatus(o3.id, OfferStatus.SENT);
  o3 = await svc.updateStatus(o3.id, OfferStatus.REJECTED);
  const r3b = await prisma.resume.findUnique({ where: { id: r3.id } });
  ok(o3.status === OfferStatus.REJECTED && r3b!.status === ResumeStatus.INTERVIEWING, '候选人拒绝后恢复 INTERVIEWING');

  // ---------- 场景4：撤回恢复 INTERVIEWING ----------
  console.log('\n场景4: 撤回恢复 INTERVIEWING');
  const c4 = await prisma.candidate.create({ data: { name: '王五', email: 'w@t.io', source: '官网' } });
  const r4 = await prisma.resume.create({ data: { candidateId: c4.id, jobId: ctx.job.id, resumeUrl: 'u', status: ResumeStatus.INTERVIEWING } });
  let o4: any = await svc.create({ candidateId: c4.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  o4 = await svc.decide(o4.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED);
  o4 = await svc.updateStatus(o4.id, OfferStatus.SENT);
  o4 = await svc.updateStatus(o4.id, OfferStatus.WITHDRAWN);
  const r4b = await prisma.resume.findUnique({ where: { id: r4.id } });
  ok(o4.status === OfferStatus.WITHDRAWN && r4b!.status === ResumeStatus.INTERVIEWING, '撤回后恢复 INTERVIEWING');

  // ---------- 场景5：岗位关闭整次拒绝 ----------
  console.log('\n场景5: 岗位关闭后审批/发送整次拒绝');
  const job2 = await prisma.job.create({ data: { title: '已关职位', department: 'RD', location: 'SH', salaryRange: '1-2', description: 'd', requirements: 'r', headcount: 1, status: JobStatus.OPEN, hiringManagerId: ctx.manager.id } });
  const c5 = await prisma.candidate.create({ data: { name: '赵六', email: 'z6@t.io', source: '官网' } });
  const o5: any = await svc.create({ candidateId: c5.id, jobId: job2.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  await prisma.job.update({ where: { id: job2.id }, data: { status: JobStatus.CLOSED } });
  await expectFail('JOB_CLOSED', '岗位关闭后审批整次拒绝', () =>
    svc.decide(o5.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED));
  const recs5 = await prisma.offerApproval.findMany({ where: { offerId: o5.id } });
  ok(recs5.length === 0, '岗位关闭拒绝后不留审批记录');
  const o5fresh = await prisma.offer.findUnique({ where: { id: o5.id } });
  ok(o5fresh!.status === OfferStatus.DRAFT, 'Offer 保持 DRAFT，版本未推进');

  // ---------- 场景6：审批中薪资变化整次拒绝 ----------
  console.log('\n场景6: 薪资变化整次拒绝');
  const c6 = await prisma.candidate.create({ data: { name: '钱七', email: 'q7@t.io', source: '官网' } });
  let o6: any = await svc.create({ candidateId: c6.id, jobId: ctx.job.id, salary: 350000, startDate: '2026-12-01', approverId: ctx.manager.id });
  o6 = await svc.decide(o6.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED);
  // 模拟审批链进行中薪资被 HR 改动（直接改库，版本+1）
  await prisma.offer.update({ where: { id: o6.id }, data: { salary: 380000, version: { increment: 1 } } });
  await expectFail('SALARY_CHANGED', '薪资变化后管理员终审整次拒绝', () =>
    svc.decide(o6.id, { sub: ctx.admin.id, role: UserRole.ADMIN }, OfferApprovalResult.APPROVED));
  const recs6 = await prisma.offerApproval.findMany({ where: { offerId: o6.id } });
  ok(recs6.length === 1, '薪资变化拒绝后不新增半条审批记录（仍只有经理 1 条）');

  // ---------- 场景7：乐观版本号并发冲突 ----------
  console.log('\n场景7: expectedVersion 冲突整次拒绝');
  const c7 = await prisma.candidate.create({ data: { name: '孙八', email: 's8@t.io', source: '官网' } });
  const o7: any = await svc.create({ candidateId: c7.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  await expectFail('CONCURRENT_MODIFICATION', '携带过期版本号被拒绝', () =>
    svc.decide(o7.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED, undefined, o7.version - 1));
  const recs7 = await prisma.offerApproval.findMany({ where: { offerId: o7.id } });
  ok(recs7.length === 0, '版本冲突后不留审批记录');

  // ---------- 场景8：同一条 Offer 真正并发（行咨询锁 + 层级唯一） ----------
  console.log('\n场景8: 同一条 Offer 并发，只能成功一次');
  const c8 = await prisma.candidate.create({ data: { name: '周九', email: 'z9@t.io', source: '官网' } });
  const o8: any = await svc.create({ candidateId: c8.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  const results = await Promise.allSettled([
    svc.decide(o8.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED),
    svc.decide(o8.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.APPROVED),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  ok(fulfilled === 1 && rejected === 1, `并发两次：成功 ${fulfilled} / 拒绝 ${rejected}`);
  const recs8 = await prisma.offerApproval.findMany({ where: { offerId: o8.id } });
  ok(recs8.length === 1, '并发后审批记录只有 1 条，无半条残留');

  // ---------- 场景9：审批驳回留 1 条 REJECTED 并终止 ----------
  console.log('\n场景9: 经理驳回');
  const c9 = await prisma.candidate.create({ data: { name: '吴十', email: 'w10@t.io', source: '官网' } });
  const o9: any = await svc.create({ candidateId: c9.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  const d9 = await svc.decide(o9.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.REJECTED, '薪资超标');
  ok(d9.status === OfferStatus.REJECTED, '驳回后 Offer REJECTED');
  await expectFail('INVALID_TRANSITION', 'REJECTED 终态不可再操作', () => svc.updateStatus(d9.id, OfferStatus.SENT));
  const recs9 = await prisma.offerApproval.findMany({ where: { offerId: o9.id } });
  ok(recs9.length === 1 && recs9[0].result === OfferApprovalResult.REJECTED, '驳回记录 1 条 REJECTED');

  // ---------- 场景10：不可绕过审批接口直接置 APPROVED ----------
  console.log('\n场景10: 禁止直接 APPROVED 绕过分级审批');
  const c10 = await prisma.candidate.create({ data: { name: '郑十一', email: 'z11@t.io', source: '官网' } });
  const o10: any = await svc.create({ candidateId: c10.id, jobId: ctx.job.id, salary: 200000, startDate: '2026-12-01', approverId: ctx.manager.id });
  await expectFail('INVALID_TRANSITION', 'PATCH status=APPROVED 被拒绝', () => svc.updateStatus(o10.id, OfferStatus.APPROVED));

  // ---------- 场景11：高薪经理初审即驳回，审批链仅 1 条 REJECTED 且不可发送 ----------
  console.log('\n场景11: 高薪 Offer 经理初审驳回');
  const c11 = await prisma.candidate.create({ data: { name: '冯十二', email: 'f12@t.io', source: '官网' } });
  const r11 = await prisma.resume.create({ data: { candidateId: c11.id, jobId: ctx.job.id, resumeUrl: 'u', status: ResumeStatus.INTERVIEWING } });
  const o11: any = await svc.create({ candidateId: c11.id, jobId: ctx.job.id, salary: 500000, startDate: '2026-12-01', approverId: ctx.manager.id });
  const d11 = await svc.decide(o11.id, { sub: ctx.manager.id, role: UserRole.HIRING_MANAGER }, OfferApprovalResult.REJECTED, '超预算');
  ok(d11.status === OfferStatus.REJECTED && d11.currentNode === OfferStatus.REJECTED, '高薪初审驳回即 REJECTED');
  const recs11 = await prisma.offerApproval.findMany({ where: { offerId: o11.id } });
  ok(recs11.length === 1 && recs11[0].level === 'HIRING_MANAGER', '仅 1 条经理驳回记录，无管理员半条记录');
  const r11b = await prisma.resume.findUnique({ where: { id: r11.id } });
  ok(r11b!.status === ResumeStatus.INTERVIEWING, '审批阶段驳回简历仍为 INTERVIEWING（未发送过 Offer）');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
