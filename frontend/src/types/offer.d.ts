import { OfferApprovalNode, OfferApprovalStatus, OfferStatus } from '../constants/enums';
declare global {
  interface OfferApproval {
    id: number;
    level: number;
    node: OfferApprovalNode;
    status: OfferApprovalStatus;
    deciderId: number | null;
    deciderName: string | null;
    salarySnapshot: string;
    reason: string | null;
    decidedAt: string | null;
    createdAt: string;
  }
  interface Offer {
    id: number;
    candidateId: number;
    jobId: number;
    salary: string;
    effectiveSalary?: string;
    annualSalary?: string;
    startDate: string;
    status: OfferStatus;
    approverId?: number | null;
    version: number;
    currentNode?: string;
    requiredLevels?: number;
    failureReason?: string | null;
    approvals?: OfferApproval[];
    job?: Job;
    approver?: User | null;
  }
}
export {};
