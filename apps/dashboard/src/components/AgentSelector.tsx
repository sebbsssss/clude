import { useAgentContext } from '../context/AgentContext';

export function AgentSelector() {
  const { agents, selectedAgent, selectAgent, loading } = useAgentContext();

  if (loading || agents.length === 0) return null;

  return (
    <div style={{
      padding: '0 12px',
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 9,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
        marginBottom: 6,
        paddingLeft: 8,
      }}>
        Agent
      </div>
      <select
        value={selectedAgent?.id || ''}
        onChange={(e) => selectAgent(e.target.value || null)}
        style={{
          width: '100%',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          padding: '8px 10px',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          background: 'var(--bg)',
          color: 'var(--text)',
          cursor: 'pointer',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23999' stroke-width='1.2'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
          paddingRight: 28,
        }}
      >
        <option value="">All Agents</option>
        {agents.map((agent) => {
          const isActive = agent.last_active &&
            (Date.now() - new Date(agent.last_active).getTime()) < 300000;
          return (
            <option key={agent.id} value={agent.id}>
              {isActive ? '\u25CF ' : '\u25CB '}{agent.name}
            </option>
          );
        })}
      </select>
    </div>
  );
}
