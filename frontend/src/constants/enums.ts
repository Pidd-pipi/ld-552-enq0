export enum JobStatus { DRAFT = 'DRAFT', OPEN = 'OPEN', PAUSED = 'PAUSED', CLOSED = 'CLOSED', ARCHIVED = 'ARCHIVED' }
export enum ResumeStatus { SUBMITTED = 'SUBMITTED', SCREENING = 'SCREENING', SHORTLISTED = 'SHORTLISTED', INTERVIEWING = 'INTERVIEWING', OFFERED = 'OFFERED', HIRED = 'HIRED', REJECTED = 'REJECTED' }
export enum InterviewResult { PASS = 'PASS', FAIL = 'FAIL', PENDING = 'PENDING' }
export enum OfferStatus { DRAFT = 'DRAFT', PENDING_APPROVAL = 'PENDING_APPROVAL', APPROVED = 'APPROVED', SENT = 'SENT', ACCEPTED = 'ACCEPTED', REJECTED = 'REJECTED', WITHDRAWN = 'WITHDRAWN' }
export enum InterviewType { PHONE = 'PHONE', ONSITE = 'ONSITE', VIDEO = 'VIDEO', TECHNICAL = 'TECHNICAL' }
export enum UserRole { HR = 'HR', INTERVIEWER = 'INTERVIEWER', HIRING_MANAGER = 'HIRING_MANAGER', ADMIN = 'ADMIN' }
export enum ApprovalLevel { HIRING_MANAGER = 'HIRING_MANAGER', ADMIN = 'ADMIN' }
export enum OfferApprovalResult { APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
/** 分级审批阈值：年薪 >= 30 万需招聘经理初审 + 管理员终审 */
export const TIERED_APPROVAL_SALARY_THRESHOLD = 300000;
export const statusText: Record<string, string> = { DRAFT: '草稿', PENDING_APPROVAL: '审批中', OPEN: '开放', PAUSED: '暂停', CLOSED: '关闭', ARCHIVED: '归档', SUBMITTED: '已投递', SCREENING: '筛选中', SHORTLISTED: '候选池', INTERVIEWING: '面试中', OFFERED: 'Offer 阶段', HIRED: '已入职', REJECTED: '已拒绝', PASS: '通过', FAIL: '未通过', PENDING: '待反馈', APPROVED: '已审批', SENT: '已发送', ACCEPTED: '已接受', WITHDRAWN: '已撤回', PENDING_HIRING_MANAGER: '待招聘经理审批', PENDING_ADMIN: '待管理员终审' };
export const failureReasonText: Record<string, string> = { OFFER_NOT_FOUND: 'Offer 不存在', JOB_CLOSED: '岗位已关闭，整次操作已拒绝', SALARY_CHANGED: '审批中薪资发生变化，请重新发起审批', CONCURRENT_MODIFICATION: '同一 Offer 存在并发操作，请刷新后重试', INVALID_TRANSITION: '当前状态不允许该操作', APPROVAL_LEVEL_LOCKED: '该审批层级暂不可处理', APPROVAL_ALREADY_PROCESSED: '该层级已审批，请勿重复操作', APPROVAL_LEVEL_SKIPPED: '审批层级不可越级', APPROVAL_PERMISSION_DENIED: '无权审批该层级', NOT_FULLY_APPROVED: '未完成全部审批层级，不能发送' };
