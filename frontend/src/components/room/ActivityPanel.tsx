import React from 'react';
import { Activity, Clock } from 'lucide-react';

export interface ActivityItem {
  id: string;
  text: string;
  timestamp: string;
}

export interface ActivityPanelProps {
  activityFeed: ActivityItem[];
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({ activityFeed }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-medium)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'var(--bg-elevated)',
        }}
      >
        <Activity size={16} color="var(--success-green)" />
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
          Real-Time Activity Stream
        </span>
      </div>

      {/* Feed list */}
      <div
        style={{
          flex: 1,
          padding: '14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {activityFeed.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            <Clock size={32} style={{ opacity: 0.3, marginBottom: '10px' }} />
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
              No recent activity yet
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Room events such as joins, role changes, and code executions will appear here.
            </div>
          </div>
        ) : (
          activityFeed.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.85rem',
                gap: '12px',
              }}
            >
              <span style={{ color: 'var(--text-main)', wordBreak: 'break-word', flex: 1 }}>
                {item.text}
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  flexShrink: 0,
                }}
              >
                {item.timestamp}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityPanel;
