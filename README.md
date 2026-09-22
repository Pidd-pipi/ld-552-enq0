# TalentFlow 招聘人才管理系统

```bash
cp .env.example .env
docker compose up --build
```

访问地址：

- 前端：http://localhost:38402
- 后端 API：http://localhost:38502/api
- 健康检查：http://localhost:38502/api/health

TalentFlow 面向企业 HR、面试官、招聘经理和管理员，覆盖职位发布、简历投递、候选人推进、面试安排、Offer 审批与审计追踪。项目采用前后端分离架构：React 18 + TypeScript + Ant Design 5 前端，NestJS + Prisma 后端，PostgreSQL 与 JWT 认证。

## 技术栈

- 前端：React 18、TypeScript、Vite、Ant Design 5、Zustand、React Router、Axios
- 后端：NestJS、Prisma ORM、JWT、RBAC Guard、审计 Interceptor
- 数据库：PostgreSQL
- 部署：Docker Compose，包含 PostgreSQL、backend、frontend

## 目录结构

```text
backend/
  prisma/schema.prisma        # 数据模型、枚举、关系
  prisma/seed.ts              # 演示数据与默认账号
  src/constants/enums.ts      # 后端共享枚举
  src/guards                  # JWT + RBAC
  src/interceptors            # 数据范围 + 审计日志
  src/modules                 # auth/jobs/candidates/resumes/interviews/offers/audit
frontend/
  src/constants/enums.ts      # 前端共享枚举
  src/components              # CandidateCard / PipelineKanban / InterviewTimeline
  src/pages                   # jobs、job detail、candidates、candidate detail、interviews
  src/stores                  # authStore / jobStore
```

## 核心能力

- 职位 Job：创建、编辑、列表筛选、详情、发布/暂停/关闭/重新打开/归档状态机。
- 候选人 Candidate + 简历 Resume：候选人检索、投递记录、简历状态推进、看板拖拽流转。
- 面试 Interview：日历视图、安排面试、面试官反馈、评分和结果记录。
- Offer：创建草稿、金额分级审批、发送、接受/拒绝/撤回状态机。

### Offer 金额分级审批规则

- **分级阈值**：按年薪（`salary × 12`）计算，阈值 30 万元（`OFFER_SENIOR_APPROVAL_ANNUAL_THRESHOLD`）。
  - 年薪 **< 30 万**：招聘经理一级审批（`HIRING_MANAGER`）。
  - 年薪 **≥ 30 万**：招聘经理先批（第 1 级）+ 管理员终审（第 2 级，`ADMIN`），未完成全部层级不得发送。
- **处理前重新核对**：提交审批、每一级审批、发送前都会在数据库事务内行锁该 Offer，重新核对岗位状态与薪资：
  - 岗位关闭（非 `OPEN`）→ 整次拒绝（`JOB_NOT_OPEN`）。
  - 审批进行中薪资被改动（与审批链 `salarySnapshot` 不一致）→ 整次拒绝（`SALARY_CHANGED`）。
  - 同一条 Offer 并发处理（`expectedVersion` 与服务端 `version` 不一致）→ 整次拒绝（`OFFER_CONCURRENT_MODIFICATION`）。
  - 拒绝时审批链所有未决层级一次性终结为 `REJECTED`，Offer 退回 `DRAFT`，审批记录不留下半条。
- **审批驳回**：任一审批人驳回，整条审批链终结，Offer 退回草稿，可修改后重新提交。
- **发送后联动简历状态**（同一事务）：
  - 发送（`APPROVED → SENT`）：候选人在该职位下最新一条简历 `INTERVIEWING → OFFERED`（已发 Offer）。
  - 候选人接受（`SENT → ACCEPTED`）：简历 `OFFERED → HIRED`（已录用）。
  - 候选人拒绝（`SENT → REJECTED`）或撤回（`SENT → WITHDRAWN`）：简历恢复 `INTERVIEWING`（面试中）。
- **统一响应字段**：所有 Offer 写接口返回 `currentNode`（当前节点）、`effectiveSalary`/`annualSalary`（生效月薪/年薪）、`version`（乐观锁版本）、`approvals`（分级审批链）、`failureReason`（失败原因，成功为 `null`）。

| failureReason | 含义 | HTTP |
|---|---|---|
| `JOB_NOT_OPEN` | 处理前发现职位已关闭 | 409 |
| `SALARY_CHANGED` | 审批/发送时发现薪资已变化 | 409 |
| `OFFER_CONCURRENT_MODIFICATION` | 同一条 Offer 并发，版本不一致 | 409 |
| `RESUME_NOT_INTERVIEWING` | 发送时简历不在面试中 | 409 |
| `APPROVAL_LEVEL_MISMATCH` | 审批层级不匹配 | 409 |
| `APPROVAL_FORBIDDEN` | 当前节点需要其他角色审批 | 403 |
| `INVALID_OFFER_ACTION` | 当前状态不允许该动作（如未审批完就发送） | 400 |
| `OFFER_NOT_FOUND` | Offer 不存在 | 404 |

并发控制采用「PostgreSQL 行锁（`SELECT … FOR UPDATE`）+ `version` 乐观锁」双保险；全部写操作在单个事务内完成，失败即回滚。
- RBAC：HR、INTERVIEWER、HIRING_MANAGER、ADMIN 四类角色；后端 `@Roles()` 控制接口，前端菜单和按钮按角色显示。
- 数据范围：面试官请求面试列表时仅返回分配给自己的面试；招聘经理按部门过滤职位。
- 操作审计：职位、简历、面试、Offer 状态变更写入 `audit_logs`，管理员可在候选人详情页查看状态流转历史。

## 默认账号

运行 seed 后可使用以下账号登录，密码均为 `talentflow123`：

| 角色 | 邮箱 |
|---|---|
| Admin | admin@talentflow.local |
| HR | hr@talentflow.local |
| HiringManager | manager@talentflow.local |
| Interviewer | interviewer@talentflow.local |

## 本地运行

```bash
npm install --workspaces
cd backend
cp .env.example .env # 如需自定义 DATABASE_URL/JWT_SECRET
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

另开终端：

```bash
cd frontend
npm run dev
```

访问：`http://localhost:38402`。后端 API 默认：`http://localhost:38502/api`。

## Docker Compose 部署

```bash
cp .env.example .env
docker compose up --build
```

后端容器启动时会自动执行迁移并初始化演示数据；已有用户时会跳过 seed，避免覆盖本地数据。

## API 清单

- `POST /api/auth/login`
- `GET /api/jobs`、`POST /api/jobs`、`GET /api/jobs/:id`、`PATCH /api/jobs/:id`、`PATCH /api/jobs/:id/status`
- `GET /api/jobs/:id/resumes`、`GET /api/jobs/:id/interviews`
- `GET /api/candidates?status=&source=&jobId=&keyword=`、`GET /api/candidates/:id`
- `GET /api/candidates/:id/resumes`、`GET /api/candidates/:id/interviews`、`GET /api/candidates/:id/offers`
- `POST /api/resumes`、`PATCH /api/resumes/:id/status`
- `GET /api/interviews?startDate=&endDate=&interviewerId=`、`POST /api/interviews`、`PATCH /api/interviews/:id`
- `POST /api/offers`（创建草稿）、`GET /api/offers/:id`、`PATCH /api/offers/:id`（草稿改薪资/入职日期）
- `POST /api/offers/:id/submit`（提交分级审批）、`POST /api/offers/:id/approve`（当前层级通过）、`POST /api/offers/:id/reject-approval`（当前层级驳回，整链终结）
- `POST /api/offers/:id/send`（全部层级通过后发送）、`POST /api/offers/:id/accept`（候选人接受）、`POST /api/offers/:id/reject`（候选人拒绝）、`POST /api/offers/:id/withdraw`（撤回）
- `GET /api/audit-logs`、`GET /api/audit-logs/candidate/:id`

## 枚举使用位置清单

提示词中 JobStatus 表格列出 `DRAFT / OPEN / CLOSED / ARCHIVED`，但业务动作要求 `OPEN → PAUSED` 和 `PAUSED → CLOSED/OPEN`，因此实现中前后端与 Prisma 均包含 `PAUSED`。

1. `backend/src/constants/enums.ts` — 后端枚举定义
2. `frontend/src/constants/enums.ts` — 前端枚举定义
3. `backend/prisma/schema.prisma` — Prisma schema 中引用所有枚举
4. `backend/src/modules/jobs/jobs.service.ts` — Job 状态流转逻辑引用 JobStatus
5. `backend/src/modules/resumes/resumes.service.ts` — 简历状态流转逻辑引用 ResumeStatus
6. `backend/src/modules/interviews/interviews.service.ts` — 面试逻辑引用 InterviewResult、InterviewType
7. `backend/src/modules/offers/offers.service.ts` — Offer 状态流转与分级审批引用 OfferStatus、OfferApprovalNode、OfferApprovalStatus
8. `backend/src/guards/roles.guard.ts` — RBAC 守卫引用 UserRole
9. `backend/src/interceptors/audit-log.interceptor.ts` — 审计日志引用各状态枚举对应的状态字段
10. `backend/src/common/filters/http-exception.filter.ts` — 异常过滤器（透传 OfferBusinessException 的 failureReason）
11. `frontend/src/types/job.d.ts` — 职位类型引用 JobStatus
12. `frontend/src/types/resume.d.ts` — 简历类型引用 ResumeStatus
13. `frontend/src/types/interview.d.ts` — 面试类型引用 InterviewResult、InterviewType
14. `frontend/src/types/offer.d.ts` — Offer 与 OfferApproval 类型引用 OfferStatus、OfferApprovalNode、OfferApprovalStatus
15. `frontend/src/stores/authStore.ts` — 认证 store 引用 UserRole
16. `frontend/src/stores/jobStore.ts` — 职位 store 引用 JobStatus

## 验证建议

```bash
npm run typecheck --workspaces
npm run build --workspace
npm --workspace backend run test:offers   # Offer 分级审批 8 个业务用例（内存 Mock，无需数据库）
curl -X POST http://localhost:38502/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@talentflow.local","password":"talentflow123"}'
```

### Offer 分级审批接口速查（先登录拿 token）

```bash
TOKEN=<登录返回的 token>
# 1) HR 创建草稿（salary 为月薪）
curl -X POST http://localhost:38502/api/offers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"candidateId":1,"jobId":1,"salary":25000,"startDate":"2026-11-01"}'
# 2) 提交审批（响应中的 currentNode=HIRING_MANAGER_APPROVAL_LEVEL_1）
curl -X POST http://localhost:38502/api/offers/1/submit -H "Authorization: Bearer $TOKEN" -d '{}'
# 3) 招聘经理批第 1 级；年薪≥30万时 currentNode 推进到 ADMIN_FINAL_APPROVAL_LEVEL_2
curl -X POST http://localhost:38502/api/offers/1/approve -H "Authorization: Bearer $TOKEN" -d '{}'
# 4) 管理员终审
curl -X POST http://localhost:38502/api/offers/1/approve -H "Authorization: Bearer $TOKEN" -d '{}'
# 5) 全部层级完成后发送（简历转 OFFERED）
curl -X POST http://localhost:38502/api/offers/1/send -H "Authorization: Bearer $TOKEN" -d '{}'
# 6) 候选人接受（简历转 HIRED）/ 拒绝 / 撤回（简历恢复 INTERVIEWING）
curl -X POST http://localhost:38502/api/offers/1/accept -H "Authorization: Bearer $TOKEN" -d '{}'
```
