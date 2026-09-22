/**
 * OffersService 分级审批逻辑测试（不依赖数据库，用内存 Mock 模拟 Prisma 事务）。
 * 运行：npx tsx test/offers.service.spec.ts
 */
import assert from 'node:assert';
import { Prisma } from '@prisma/client';
import { OffersService } from '../src/modules/offers/offers.service';
import { OfferApprovalNode, OfferApprovalStatus, OfferStatus, ResumeStatus, UserRole } from '../src/constants/enums';
import { OfferBusinessException } from '../src/common/exceptions/offer.exceptions';

type OfferRow = {
  id: number; candidateId: number; jobId: number; salary: Prisma.Decimal; startDate: Date;
  status: OfferStatus; approverId: number | null; version: number;
  candidate: any; job: any; approver: any; approvals: any[];
};

const hr = { sub: 2, role: UserRole.HR, department: '产品研发部' };
const manager = { sub: 3, role: UserRole.HIRING_MANAGER, department: '产品研发部' };
const otherManager = { sub: 9, role: UserRole.HIRING_MANAGER, department: '市场部' };
const admin = { sub: 1, role: UserRole.ADMIN };

class MockTx {
  constructor(public db: MockDb) {}
  offer = {
    findUnique: async ({ where }: any) => this.db.offers.find((o) => o.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const o = this.db.offers.find((x) => x.id === where.id);
      if (!o) throw new Error('not found');
      return this.relate(o);
    },
    create: async ({ data }: any) => {
      const row: OfferRow = { id: ++this.db.seq.offer, candidateId: data.candidateId, jobId: data.jobId, salary: data.salary, startDate: data.startDate, status: data.status, approverId: null, version: 1, candidate: null, job: null, approver: null, approvals: [] };
      this.db.offers.push(row);
      return this.relate(row);
    },    update: async ({ where, data }: any) => {
      const o = this.db.offers.find((x) => x.id === where.id)!;
      Object.assign(o, stripInc(data));
      if (data.version?.increment) o.version += data.version.increment;
      return this.relate(o);
    },
  };
  offerApproval = {
    create: async ({ data }: any) => {
      const row = { id: ++this.db.seq.approval, offerId: data.offerId, level: data.level, node: data.node, status: data.status ?? OfferApprovalStatus.PENDING, deciderId: data.deciderId ?? null, salarySnapshot: data.salarySnapshot, reason: data.reason ?? null, decidedAt: data.decidedAt ?? null, createdAt: new Date(), decider: null };
      this.db.approvals.push(row);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      const before = this.db.approvals.length;
      this.db.approvals = this.db.approvals.filter((a) => a.offerId !== where.offerId);
      return { count: before - this.db.approvals.length };
    },
    update: async ({ where, data }: any) => {
      const a = this.db.approvals.find((x) => x.id === where.id)!;
      Object.assign(a, data);
      return a;
    },
    updateMany: async ({ where, data }: any) => {
      const targets = this.db.approvals.filter((a) => a.offerId === where.offerId && a.status === where.status);
      targets.forEach((a) => Object.assign(a, data));
      return { count: targets.length };
    },
    count: async ({ where }: any) => this.db.approvals.filter((a) => a.offerId === where.offerId && a.status === where.status).length,
  };
  resume = {
    update: async ({ where, data }: any) => {
      const r = this.db.resumes.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return r;
    },
  };
  auditLog = { create: async ({ data }: any) => { this.db.audit.push(data); return data; } };
  job = { findUnique: async ({ where }: any) => this.db.jobs.find((j) => j.id === where.id) ?? null };
  candidate = { findUnique: async ({ where }: any) => this.db.candidates.find((c) => c.id === where.id) ?? null };
  $queryRaw = async (query: { strings: string[]; values: any[] }) => {
    const sql = query.strings.join('?');
    const values = query.values;
    if (sql.includes('FOR UPDATE')) {
      const id = values[0] as number;
      return this.db.offers.some((o) => o.id === id) ? [{ id }] : [];
    }
    if (sql.includes('FROM "Resume"')) {
      const [candidateId, jobId] = values;
      const r = this.db.resumes.find((x) => x.candidateId === candidateId && x.jobId === jobId);
      return r ? [{ id: r.id, status: r.status }] : [];
    }
    return [];
  };
  $queryRow = async () => ({ id: this.db._lockedId });

  private relate(o: OfferRow): OfferRow {
    return {
      ...o,
      job: this.db.jobs.find((j) => j.id === o.jobId)!,
      candidate: this.db.candidates.find((c) => c.id === o.candidateId)!,
      approver: o.approverId ? this.db.users.find((u) => u.id === o.approverId)! : null,
      approvals: this.db.approvals.filter((a) => a.offerId === o.id).sort((a, b) => a.level - b.level).map((a) => ({ ...a, decider: a.deciderId ? this.db.users.find((u) => u.id === a.deciderId)! : null })),
    };
  }
}

class MockDb {
  seq = { offer: 0, approval: 0 };
  offers: OfferRow[] = [];
  approvals: any[] = [];
  audit: any[] = [];
  resumes: any[] = [];
  _lockedId = 1;
  users = [
    { id: 1, name: '管理员', email: 'a', role: UserRole.ADMIN, department: null },
    { id: 3, name: '经理', email: 'm', role: UserRole.HIRING_MANAGER, department: '产品研发部' },
  ];
  jobs = [
    { id: 10, title: '高级工程师', department: '产品研发部', status: 'OPEN' as any },
    { id: 11, title: '关闭岗位', department: '产品研发部', status: 'CLOSED' as any },
  ];
  candidates = [{ id: 20, name: '张三', email: 'z@x.com' }];
  reset() { this.offers = []; this.approvals = []; this.audit = []; this._lockedId = 1; }
}

function stripInc(data: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'version' && (v as any)?.increment) continue;
    (out as any)[k] = v;
  }
  return out;
}

function makeService(db: MockDb) {
  const tx = new MockTx(db);
  const prisma = {
    ...tx,
    offer: tx.offer,
    job: tx.job,
    candidate: tx.candidate,
    $transaction: async (fn: any) => fn(tx),
  } as any;
  return new OffersService(prisma);
}

async function expectFailure(fn: () => Promise<unknown>, reason: string) {
  try {
    await fn();
    assert.fail(`应当抛出 ${reason}`);
  } catch (e) {
    assert(e instanceof OfferBusinessException, `期望 OfferBusinessException，实际 ${(e as Error).constructor.name}: ${(e as Error).message}`);
    assert.equal((e as OfferBusinessException).failureReason, reason);
  }
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  const db = new MockDb();
  db.resumes = [{ id: 100, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
  const service = makeService(db);

  // ---------- 场景一：年薪 < 30 万（月薪 20k），经理单级审批 ----------
  await test('低薪 Offer 仅需经理一级审批，经理通过后可发送', async () => {
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 20000, startDate: new Date().toISOString() });
    assert.equal(created.requiredLevels, 1);
    assert.equal(created.annualSalary, '240000');
    assert.equal(created.currentNode, 'DRAFT_PENDING_SUBMIT');

    const submitted = await service.submit(created.id, undefined, hr);
    assert.equal(submitted.approvals.length, 1);
    assert.equal(submitted.approvals[0].node, OfferApprovalNode.HIRING_MANAGER);
    assert.equal(submitted.currentNode, 'HIRING_MANAGER_APPROVAL_LEVEL_1');

    // 未审批完成不得发送
    await expectFailure(() => service.send(created.id, {}, hr), 'INVALID_OFFER_ACTION');

    // 管理员不能顶替经理节点？经理节点允许管理员代审批
    const approved = await service.approve(created.id, {}, manager);
    assert.equal(approved.status, OfferStatus.APPROVED);
    assert.equal(approved.approverId, manager.sub);
    assert.equal(approved.currentNode, 'APPROVED_PENDING_SEND');

    const sent = await service.send(created.id, {}, hr);
    assert.equal(sent.status, OfferStatus.SENT);
    assert.equal(sent.currentNode, 'SENT_PENDING_CANDIDATE_DECISION');
    assert.equal(db.resumes[0].status, ResumeStatus.OFFERED);

    const accepted = await service.accept(created.id, {}, hr);
    assert.equal(accepted.status, OfferStatus.ACCEPTED);
    assert.equal(db.resumes[0].status, ResumeStatus.HIRED);
  });

  // ---------- 场景二：年薪 >= 30 万（月薪 25k = 30 万），两级审批 ----------
  await test('年薪达到 30 万需经理先批、管理员终审，未完成全部层级不得发送', async () => {
    db.reset();
    db._lockedId = 2;
    db.resumes = [{ id: 101, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 25000, startDate: new Date().toISOString() });
    assert.equal(created.annualSalary, '300000');
    assert.equal(created.requiredLevels, 2);

    await service.submit(created.id, undefined, hr);
    const afterManager = await service.approve(created.id, {}, manager);
    assert.equal(afterManager.status, OfferStatus.DRAFT, '经理批完仍处于审批中（状态保持 DRAFT，节点推进）');
    assert.equal(afterManager.currentNode, 'ADMIN_FINAL_APPROVAL_LEVEL_2');

    // 只完成经理一级，发送必须被拒
    await expectFailure(() => service.send(created.id, {}, hr), 'INVALID_OFFER_ACTION');

    // 经理不能终审管理员节点
    await expectFailure(() => service.approve(created.id, {}, manager), 'APPROVAL_FORBIDDEN');
    // 其他部门经理不能审批
    await expectFailure(() => service.approve(created.id, {}, otherManager), 'APPROVAL_FORBIDDEN');

    const final = await service.approve(created.id, {}, admin);
    assert.equal(final.status, OfferStatus.APPROVED);
    assert.equal(final.approverId, admin.sub);
    const sent = await service.send(created.id, {}, hr);
    assert.equal(sent.status, OfferStatus.SENT);
  });

  // ---------- 场景三：审批中职位关闭，整次拒绝，无悬挂审批 ----------
  await test('处理前发现职位关闭：整次拒绝，审批记录不留半条', async () => {
    db.reset();
    db._lockedId = 3;
    db.resumes = [{ id: 102, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 30000, startDate: new Date().toISOString() });
    await service.submit(created.id, undefined, hr);
    db.jobs[0].status = 'CLOSED';
    await expectFailure(() => service.approve(created.id, {}, manager), 'JOB_NOT_OPEN');
    const offer = db.offers.find((o) => o.id === created.id)!;
    assert.equal(offer.status, OfferStatus.DRAFT);
    assert.equal(offer.approverId, null);
    const pending = db.approvals.filter((a) => a.offerId === created.id && a.status === OfferApprovalStatus.PENDING);
    assert.equal(pending.length, 0, '不允许残留 PENDING 半条记录');
    db.jobs[0].status = 'OPEN';
  });

  // ---------- 场景四：审批中薪资变化，整次拒绝 ----------
  await test('处理前发现薪资变化：整次拒绝，审批链全部终结', async () => {
    db.reset();
    db._lockedId = 4;
    db.resumes = [{ id: 103, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 30000, startDate: new Date().toISOString() });
    await service.submit(created.id, undefined, hr);
    // 模拟提交后薪资被直接改动（快照仍为旧值）
    db.offers.find((o) => o.id === created.id)!.salary = new Prisma.Decimal(33000);
    await expectFailure(() => service.approve(created.id, {}, manager), 'SALARY_CHANGED');
    const pending = db.approvals.filter((a) => a.offerId === created.id && a.status === OfferApprovalStatus.PENDING);
    assert.equal(pending.length, 0);
  });

  // ---------- 场景五：版本号并发冲突 ----------
  await test('同一条 Offer 并发（版本不匹配）整次拒绝', async () => {
    db.reset();
    db._lockedId = 5;
    db.resumes = [{ id: 104, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 20000, startDate: new Date().toISOString() });
    const submitted = await service.submit(created.id, 1, hr); // 提交后版本变为 2
    assert.equal(submitted.version, 2);
    await expectFailure(() => service.approve(created.id, { expectedVersion: 1 }, manager), 'OFFER_CONCURRENT_MODIFICATION');
    // 用新版本仍可正常处理
    const ok = await service.approve(created.id, { expectedVersion: submitted.version }, manager);
    assert.equal(ok.status, OfferStatus.APPROVED);
  });

  // ---------- 场景六：驳回不留半条 ----------
  await test('任一层级驳回：其余层级一并终结，Offer 退回草稿', async () => {
    db.reset();
    db._lockedId = 6;
    db.resumes = [{ id: 105, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 30000, startDate: new Date().toISOString() });
    await service.submit(created.id, undefined, hr);
    await service.rejectApproval(created.id, { reason: '薪资超标' }, manager);
    const pending = db.approvals.filter((a) => a.offerId === created.id && a.status === OfferApprovalStatus.PENDING);
    assert.equal(pending.length, 0);
    assert.equal(db.offers.find((o) => o.id === created.id)!.status, OfferStatus.DRAFT);
  });

  // ---------- 场景七：拒绝/撤回恢复面试中 ----------
  await test('候选人拒绝与撤回均恢复简历为面试中', async () => {
    db.reset();
    db._lockedId = 7;
    db.resumes = [{ id: 106, candidateId: 20, jobId: 10, status: ResumeStatus.INTERVIEWING }];
    const created = await service.create({ candidateId: 20, jobId: 10, salary: 20000, startDate: new Date().toISOString() });
    await service.submit(created.id, undefined, hr);
    await service.approve(created.id, {}, manager);
    await service.send(created.id, {}, hr);
    assert.equal(db.resumes[0].status, ResumeStatus.OFFERED);
    await service.rejectByCandidate(created.id, { reason: '已入职其他公司' }, hr);
    assert.equal(db.resumes[0].status, ResumeStatus.INTERVIEWING);

    // 撤回路径
    const c2 = await service.create({ candidateId: 20, jobId: 10, salary: 20000, startDate: new Date().toISOString() });
    db._lockedId = c2.id;
    await service.submit(c2.id, undefined, hr);
    await service.approve(c2.id, {}, manager);
    await service.send(c2.id, {}, hr);
    await service.withdraw(c2.id, { reason: '岗位调整' }, hr);
    assert.equal(db.resumes[0].status, ResumeStatus.INTERVIEWING);
  });

  // ---------- 场景八：草稿可建，但提交/发送时职位关闭被拒 ----------
  await test('处理前职位已关闭：提交审批整次拒绝', async () => {
    const draft = await service.create({ candidateId: 20, jobId: 11, salary: 10000, startDate: new Date().toISOString() });
    assert.equal(draft.status, OfferStatus.DRAFT);
    await expectFailure(() => service.submit(draft.id, undefined, hr), 'JOB_NOT_OPEN');
  });

  console.log(`\n全部 ${passed} 个用例通过`);
}

main().catch((e) => { console.error(e); process.exit(1); });
