import { Card, Descriptions, List, Steps, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InterviewTimeline from '../components/InterviewTimeline';
import { offerApprovalNodeText, offerApprovalStatusText, offerCurrentNodeText, statusText } from '../constants/enums';
import { api } from '../utils/api';

const approvalStepStatus = (s: string): 'wait' | 'process' | 'finish' | 'error' => {
  if (s === 'APPROVED') return 'finish';
  if (s === 'REJECTED') return 'error';
  return 'wait';
};

function OfferPanel({ offer }: { offer: Offer }) {
  const currentNodeText = offer.currentNode
    ? offer.currentNode.startsWith('HIRING_MANAGER_APPROVAL')
      ? `第 ${offer.currentNode.split('_').pop()} 级 · 招聘经理审批中`
      : offer.currentNode.startsWith('ADMIN_FINAL_APPROVAL')
        ? `第 ${offer.currentNode.split('_').pop()} 级 · 管理员终审中`
        : offerCurrentNodeText[offer.currentNode] || offer.currentNode
    : statusText[offer.status];
  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Descriptions column={2} size="small"
        items={[
          { key: 'job', label: '职位', children: offer.job?.title },
          { key: 'status', label: 'Offer 状态', children: <Tag color="green">{statusText[offer.status]}</Tag> },
          { key: 'salary', label: '生效薪资（月薪）', children: `¥ ${offer.effectiveSalary ?? offer.salary}` },
          { key: 'annual', label: '折算年薪', children: offer.annualSalary ? `¥ ${offer.annualSalary}` : '—' },
          { key: 'node', label: '当前节点', children: <Tag color="blue">{currentNodeText}</Tag> },
          { key: 'levels', label: '所需审批层级', children: offer.requiredLevels ?? '—' },
        ]}
      />
      {offer.approvals && offer.approvals.length > 0 && (
        <Steps
          size="small"
          direction="vertical"
          style={{ marginTop: 12 }}
          items={offer.approvals.map((a) => ({
            title: `第 ${a.level} 级 · ${offerApprovalNodeText[a.node]}`,
            status: approvalStepStatus(a.status),
            description: (
              <span>
                <Tag>{offerApprovalStatusText[a.status]}</Tag>
                {a.deciderName ? `审批人：${a.deciderName}` : '待处理'}
                {a.reason ? ` · ${a.reason}` : ''}
                {a.status === 'PENDING' ? ` · 提交薪资快照 ¥${a.salarySnapshot}` : ''}
              </span>
            ),
          }))}
        />
      )}
      {offer.failureReason && <Typography.Text type="danger">失败原因：{offer.failureReason}</Typography.Text>}
    </Card>
  );
}

export default function CandidateDetailPage() {
  const { id } = useParams();
  const [candidate, setCandidate] = useState<Candidate>();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  useEffect(() => {
    Promise.all([
      api.get(`/candidates/${id}`),
      api.get(`/candidates/${id}/interviews`),
      api.get(`/audit-logs/candidate/${id}`).catch(() => ({ data: [] })),
    ]).then(([c, i, a]) => { setCandidate(c.data); setInterviews(i.data); setAudits(a.data); });
  }, [id]);
  return <>
    <h1 className="page-title">{candidate?.name}</h1>
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, marginTop: 18 }}>
      <Card className="tf-card">
        <Descriptions column={1} size="small" items={[
          { key: 'email', label: '邮箱', children: candidate?.email },
          { key: 'phone', label: '手机', children: candidate?.phone },
          { key: 'source', label: '来源', children: candidate?.source },
        ]} />
      </Card>
      <Tabs items={[
        { key: 'resumes', label: '投递记录', children: <List dataSource={candidate?.resumes || []} renderItem={(r) => <List.Item><List.Item.Meta title={r.job?.title} description={<><Tag>{statusText[r.status]}</Tag>{r.resumeUrl}</>} /></List.Item>} /> },
        { key: 'timeline', label: 'InterviewTimeline 面试时间线', children: <InterviewTimeline interviews={interviews} /> },
        { key: 'offers', label: 'Offer 分级审批', children: (candidate?.offers || []).length === 0 ? <Typography.Text type="secondary">暂无 Offer</Typography.Text> : (candidate?.offers || []).map((o) => <OfferPanel key={o.id} offer={o} />) },
        { key: 'audit', label: '状态流转审计', children: <List dataSource={audits} renderItem={(a) => <List.Item>{a.entity} #{a.entityId}: {a.beforeStatus} → {a.afterStatus} · {a.actor?.name || '系统'} · {a.reason}</List.Item>} /> },
      ]} />
    </div>
  </>;
}
