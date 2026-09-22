import { OfferStatus, ApprovalLevel, OfferApprovalResult } from '../constants/enums';
declare global {
  interface OfferApproval {
    id: number;
    offerId: number;
    level: ApprovalLevel;
    result: OfferApprovalResult;
    approverId: number;
    approver?: User;
    comment?: string;
    salarySnap: string;
    createdAt: string;
  }
  interface Offer {
    id: number;
    candidateId: number;
    jobId: number;
    salary: string;
    effectiveSalary?: string;
    startDate: string;
    status: OfferStatus;
    approverId: number;
    version: number;
    currentNode?: string;
    failureReason?: string | null;
    job?: Job;
    approver?: User;
    approvals?: OfferApproval[];
  }
}
export {};
