import { create } from 'zustand';
import { OfferApprovalResult, OfferStatus } from '../constants/enums';
import { api } from '../utils/api';

type OfferState = {
  offer?: Offer;
  loading: boolean;
  load: (id: number) => Promise<void>;
  decide: (id: number, result: OfferApprovalResult, comment?: string, expectedVersion?: number) => Promise<Offer>;
  changeStatus: (id: number, status: OfferStatus, reason?: string, expectedVersion?: number) => Promise<Offer>;
};

export const useOfferStore = create<OfferState>((set) => ({
  offer: undefined,
  loading: false,
  async load(id) {
    set({ loading: true });
    const { data } = await api.get(`/offers/${id}`);
    set({ offer: data, loading: false });
  },
  async decide(id, result, comment, expectedVersion) {
    const { data } = await api.post(`/offers/${id}/approvals`, { result, comment, expectedVersion });
    set({ offer: data });
    return data;
  },
  async changeStatus(id, status, reason, expectedVersion) {
    const { data } = await api.patch(`/offers/${id}/status`, { status, reason, expectedVersion });
    set({ offer: data });
    return data;
  },
}));
