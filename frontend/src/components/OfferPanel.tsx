import { Button, Card, Descriptions, List, Space, Tag, message } from 'antd';
import { useState } from 'react';
import { OfferApprovalResult, OfferStatus, UserRole, failureReasonText, statusText } from '../constants/enums';
import { useAuthStore } from '../stores/authStore';
import { useOfferStore } from '../stores/offerStore';

const levelText: Record<string, string> = { HIRING_MANAGER: '招聘经理审批', ADMIN: '管理员终审' };

export default function OfferPanel({ offers, onChanged }: { offers: Offer[]; onChanged?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const decide = useOfferStore((s) => s.decide);
  const changeStatus = useOfferStore((s) => s.changeStatus);
  const [busyId, setBusyId] = useState<number>();

  const fail = (e: any) => {
    const reason: string | undefined = e?.response?.data?.failureReason;
    message.error(reason ? failureReasonText[reason] || reason : e?.response?.data?.message || '操作失败');
  };

  const handle = async (o: Offer, run: () => Promise<unknown>) => {
    setBusyId(o.id);
    try {
      await run();
      onChanged?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <List
      dataSource={offers}
      renderItem={(o) => (
        <List.Item>
          <Card size="small" style={{ width: '100%' }} title={`${o.job?.title || `Offer #${o.id}`} · ${o.effectiveSalary ?? o.salary} / 年`}>
            <Descriptions column={2} size="small" items={[
              { key: 'status', label: '状态', children: <Tag color="blue">{statusText[o.status]}</Tag> },
              { key: 'node', label: '当前节点', children: <Tag color="orange">{statusText[o.currentNode || o.status]}</Tag> },
              { key: 'salary', label: '生效薪资', children: o.effectiveSalary ?? '-' },
              { key: 'version', label: '版本', children: o.version },
            ]} />
            {o.failureReason ? <div style={{ color: '#cf1322' }}>{failureReasonText[o.failureReason] || o.failureReason}</div> : null}
            {o.approvals?.length ? (
              <List
                size="small"
                header="审批记录"
                dataSource={o.approvals}
                renderItem={(a) => (
                  <List.Item>
                    {levelText[a.level]} · {statusText[a.result]} · {a.approver?.name} · {a.salarySnap}
                    {a.comment ? ` · ${a.comment}` : ''}
                  </List.Item>
                )}
              />
            ) : null}
            <Space style={{ marginTop: 8 }}>
              {[OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL].includes(o.status) && user?.role === UserRole.HIRING_MANAGER && (
                <>
                  <Button type="primary" size="small" loading={busyId === o.id} onClick={() => handle(o, () => decide(o.id, OfferApprovalResult.APPROVED, undefined, o.version))}>经理通过</Button>
                  <Button danger size="small" loading={busyId === o.id} onClick={() => handle(o, () => decide(o.id, OfferApprovalResult.REJECTED, undefined, o.version))}>驳回</Button>
                </>
              )}
              {o.status === OfferStatus.PENDING_APPROVAL && user?.role === UserRole.ADMIN && (
                <>
                  <Button type="primary" size="small" loading={busyId === o.id} onClick={() => handle(o, () => decide(o.id, OfferApprovalResult.APPROVED, undefined, o.version))}>管理员终审通过</Button>
                  <Button danger size="small" loading={busyId === o.id} onClick={() => handle(o, () => decide(o.id, OfferApprovalResult.REJECTED, undefined, o.version))}>驳回</Button>
                </>
              )}
              {o.status === OfferStatus.APPROVED && [UserRole.HR, UserRole.ADMIN].includes(user?.role as UserRole) && (
                <Button type="primary" size="small" loading={busyId === o.id} onClick={() => handle(o, () => changeStatus(o.id, OfferStatus.SENT, undefined, o.version))}>发送 Offer</Button>
              )}
              {o.status === OfferStatus.SENT && [UserRole.HR, UserRole.ADMIN].includes(user?.role as UserRole) && (
                <>
                  <Button type="primary" size="small" loading={busyId === o.id} onClick={() => handle(o, () => changeStatus(o.id, OfferStatus.ACCEPTED, undefined, o.version))}>候选人接受</Button>
                  <Button size="small" loading={busyId === o.id} onClick={() => handle(o, () => changeStatus(o.id, OfferStatus.REJECTED, undefined, o.version))}>候选人拒绝</Button>
                  <Button danger size="small" loading={busyId === o.id} onClick={() => handle(o, () => changeStatus(o.id, OfferStatus.WITHDRAWN, undefined, o.version))}>撤回</Button>
                </>
              )}
            </Space>
          </Card>
        </List.Item>
      )}
    />
  );
}
