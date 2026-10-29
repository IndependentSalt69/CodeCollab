import React from 'react';
import { Users, Crown, Eye, ArrowRightLeft } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';

export interface RoomMember {
  socketId: string;
  user?: {
    name?: string;
    username?: string;
    _id?: string;
    id?: string;
    email?: string;
  };
}

export interface ParticipantsPanelProps {
  currentUsername?: string;
  currentUserId?: string;
  myId: string;
  driverId: string | null;
  members: RoomMember[];
  onTransferDriver?: (targetSocketId: string) => void;
  transferStatus?: string;
}

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  currentUsername = 'You',
  currentUserId,
  myId,
  driverId,
  members,
  onTransferDriver,
  transferStatus,
}) => {
  const isDriver = Boolean(myId && driverId === myId);

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
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={16} color="var(--accent-cyan)" />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
            Active Participants
          </span>
        </div>
        <Badge variant="cyan">{members.length + 1} online</Badge>
      </div>

      {transferStatus && (
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'var(--primary-violet-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--accent-cyan)',
          }}
        >
          {transferStatus}
        </div>
      )}

      {/* Participants List */}
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
        {/* Current User */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            backgroundColor: 'var(--bg-elevated)',
            border: `1px solid ${isDriver ? 'rgba(139, 92, 246, 0.4)' : 'var(--border-medium)'}`,
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                backgroundColor: isDriver ? 'var(--primary-violet)' : 'var(--border-medium)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              {currentUsername.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {currentUsername} (You)
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {isDriver ? 'Active Driver' : 'Observing as Viewer'}
              </div>
            </div>
          </div>

          <Badge variant={isDriver ? 'violet' : 'neutral'} icon={isDriver ? <Crown size={12} /> : <Eye size={12} />}>
            {isDriver ? 'Driver' : 'Viewer'}
          </Badge>
        </div>

        {/* Other Members */}
        {members.map((member) => {
          const memberIsDriver = member.socketId === driverId;
          const name = member.user?.name || member.user?.username || member.socketId.slice(0, 8);

          return (
            <div
              key={member.socketId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                border: `1px solid ${memberIsDriver ? 'rgba(139, 92, 246, 0.4)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    backgroundColor: memberIsDriver ? 'var(--primary-violet)' : 'var(--bg-elevated)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                  }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-main)' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {memberIsDriver ? 'Active Driver' : 'Viewer'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge
                  variant={memberIsDriver ? 'violet' : 'neutral'}
                  icon={memberIsDriver ? <Crown size={12} /> : <Eye size={12} />}
                >
                  {memberIsDriver ? 'Driver' : 'Viewer'}
                </Badge>

                {isDriver && !memberIsDriver && onTransferDriver && (
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<ArrowRightLeft size={12} />}
                    onClick={() => onTransferDriver(member.socketId)}
                    title={`Transfer Driver wheel to ${name}`}
                  >
                    Transfer
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ParticipantsPanel;
