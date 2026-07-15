// /me — AGENT self card (03 §4). No dedicated self-cockpit page was built in the
// Money Spine wave, so this minimal wrapper resolves the signed-in agent's own id
// via GET /agents/me (endpoints.agentMe) and hands off to the already-built
// AgentDetail hub at /agents/:id — the same target the dashboard's «Mening
// ko'rsatkichlarim →» link uses. Keeps the /me route honest and reachable.
// TODO(me-page): replace with a bespoke agent self-cockpit if the spec grows one.
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../lib/api';
import { ErrorState } from '../components';
import { useT } from '../components/LangContext';
import type { Agent } from '../lib/types';

export default function Me() {
  const t = useT();
  const q = useQuery({
    queryKey: ['agent', 'me'],
    queryFn: () => endpoints.agentMe() as Promise<Agent>,
  });

  if (q.isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '30vh auto' }} />;
  }
  if (q.isError || !q.data?.id) {
    return (
      <ErrorState
        error={q.error ?? new Error(t("Ma'lumotlarni yuklab bo'lmadi"))}
        message="Ko'rsatkichlaringizni yuklab bo'lmadi"
        onRetry={() => void q.refetch()}
      />
    );
  }
  return <Navigate to={`/agents/${q.data.id}`} replace />;
}
