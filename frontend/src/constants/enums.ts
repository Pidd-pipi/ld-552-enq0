export enum JobStatus { DRAFT = 'DRAFT', OPEN = 'OPEN', PAUSED = 'PAUSED', CLOSED = 'CLOSED', ARCHIVED = 'ARCHIVED' }
export enum ResumeStatus { SUBMITTED = 'SUBMITTED', SCREENING = 'SCREENING', SHORTLISTED = 'SHORTLISTED', INTERVIEWING = 'INTERVIEWING', OFFERED = 'OFFERED', HIRED = 'HIRED', REJECTED = 'REJECTED' }
export enum InterviewResult { PASS = 'PASS', FAIL = 'FAIL', PENDING = 'PENDING' }
export enum OfferStatus { DRAFT = 'DRAFT', APPROVED = 'APPROVED', SENT = 'SENT', ACCEPTED = 'ACCEPTED', REJECTED = 'REJECTED', WITHDRAWN = 'WITHDRAWN' }
export enum InterviewType { PHONE = 'PHONE', ONSITE = 'ONSITE', VIDEO = 'VIDEO', TECHNICAL = 'TECHNICAL' }
export enum UserRole { HR = 'HR', INTERVIEWER = 'INTERVIEWER', HIRING_MANAGER = 'HIRING_MANAGER', ADMIN = 'ADMIN' }
export enum OfferApprovalNode { HIRING_MANAGER = 'HIRING_MANAGER', ADMIN = 'ADMIN' }
export enum OfferApprovalStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }
export const statusText: Record<string, string> = { DRAFT: '草稿', OPEN: '开放', PAUSED: '暂停', CLOSED: '关闭', ARCHIVED: '归档', SUBMITTED: '已投递', SCREENING: '筛选中', SHORTLISTED: '候选池', INTERVIEWING: '面试中', OFFERED: '已发 Offer', HIRED: '已录用', REJECTED: '已拒绝', PASS: '通过', FAIL: '未通过', PENDING: '待反馈', APPROVED: '已审批', SENT: '已发送', ACCEPTED: '已接受', WITHDRAWN: '已撤回' };
export const offerApprovalNodeText: Record<string, string> = { HIRING_MANAGER: '招聘经理审批', ADMIN: '管理员终审' };
export const offerApprovalStatusText: Record<string, string> = { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' };
export const offerCurrentNodeText: Record<string, string> = {
  DRAFT_PENDING_SUBMIT: '草稿·待提交审批',
  APPROVAL_REJECTED: '审批驳回·退回草稿',
  APPROVED_PENDING_SEND: '审批完成·待发送',
  SENT_PENDING_CANDIDATE_DECISION: '已发送·待候选人确认',
  COMPLETED_ACCEPTED: '已完成·候选人接受',
  COMPLETED_REJECTED: '已完成·候选人拒绝',
  COMPLETED_WITHDRAWN: '已完成·已撤回',
};
