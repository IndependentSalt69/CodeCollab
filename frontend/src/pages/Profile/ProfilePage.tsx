import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Mail, Shield, Key, LogOut, ArrowLeft, Settings, Check, Clock } from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

export interface ProfilePageProps {
  onBackToDashboard: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onBackToDashboard }) => {
  const { user, logout } = useAuth();

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '36px 16px', color: 'var(--text-main)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
        <button
          onClick={onBackToDashboard}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          <ArrowLeft size={16} />
          <span>Back to Dashboard</span>
        </button>

        <Button
          variant="danger"
          size="sm"
          leftIcon={<LogOut size={15} />}
          onClick={logout}
        >
          Sign Out
        </Button>
      </div>

      {/* Profile Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-xl)',
          padding: '32px',
          boxShadow: 'var(--shadow-md)',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'var(--primary-violet-subtle)',
              border: '2px solid var(--primary-violet)',
              color: 'var(--primary-violet)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
              fontWeight: 700,
              boxShadow: 'var(--shadow-glow-violet)',
            }}
          >
            {user?.username?.charAt(0).toUpperCase() || 'U'}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>
                {user?.username}
              </h2>
              <Badge variant="green" icon={<Check size={12} />}>
                Active Session
              </Badge>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {user?.email}
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>USER ID</div>
            <code style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
              {user?.id || '—'}
            </code>
          </div>

          <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>AUTHENTICATION TYPE</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
              JWT Bearer &bull; SHA-256
            </div>
          </div>
        </div>
      </div>

      {/* Settings / Preferences Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-xl)',
          padding: '32px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <Settings size={20} color="var(--primary-violet)" />
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-heading)' }}>
            Workspace Settings & Status
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Monaco Editor Theme</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dark theme (vs-dark) aligned with CodeCollab tokens</div>
            </div>
            <Badge variant="cyan">Active</Badge>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Execution Sandboxing</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dockerode Linux containers with cgroup resource constraints</div>
            </div>
            <Badge variant="green">Enabled (Python 3.11)</Badge>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Execution History Persistence</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Historical runs archive and per-user execution telemetry</div>
            </div>
            <Badge variant="amber" icon={<Clock size={11} />}>Planned Feature</Badge>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Voice Collaboration (WebRTC)</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Integrated peer-to-peer audio channels</div>
            </div>
            <Badge variant="amber" icon={<Clock size={11} />}>Planned Feature</Badge>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
