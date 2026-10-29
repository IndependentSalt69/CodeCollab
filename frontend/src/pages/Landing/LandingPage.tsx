import React from 'react';
import {
  Users,
  Shield,
  Zap,
  Terminal as TerminalIcon,
  MessageSquare,
  Lock,
  ArrowRight,
  Code2,
  Cpu,
  Layers,
  Sparkles,
  CheckCircle2,
  Server,
  Play
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

interface LandingPageProps {
  onStartCoding: () => void;
  onExploreFeatures?: () => void;
  onLogin?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartCoding,
  onExploreFeatures,
  onLogin,
}) => {
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-main)', minHeight: '100vh', color: 'var(--text-main)' }}>
      {/* Hero Section */}
      <section
        style={{
          position: 'relative',
          padding: '80px 24px 60px',
          maxWidth: '1200px',
          margin: '0 auto',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Subtle background glow */}
        <div
          style={{
            position: 'absolute',
            top: '20%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, rgba(34, 211, 238, 0.05) 50%, transparent 70%)',
            filter: 'blur(50px)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'inline-flex', marginBottom: '20px' }}>
            <Badge variant="cyan" icon={<Sparkles size={12} />}>
              CodeCollab 2.0 &bull; Isolated Container Sandboxing
            </Badge>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2.5rem, 6vw, 4.25rem)',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              margin: '0 auto 24px',
              maxWidth: '920px',
            }}
          >
            Collaborative Coding for Engineering Teams,{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, var(--accent-cyan) 0%, var(--primary-violet) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Zero Third-Party APIs
            </span>
          </h1>

          <p
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.25rem)',
              lineHeight: 1.6,
              color: 'var(--text-muted)',
              maxWidth: '680px',
              margin: '0 auto 36px',
            }}
          >
            Create instant rooms, collaborate with designated Driver/Viewer controls, chat in real time, and execute code safely inside ephemeral Linux container environments.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              flexWrap: 'wrap',
              marginBottom: '64px',
            }}
          >
            <Button
              size="lg"
              variant="primary"
              rightIcon={<ArrowRight size={18} />}
              onClick={onStartCoding}
            >
              Start Coding
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                if (onExploreFeatures) onExploreFeatures();
                else scrollToSection('features-section');
              }}
            >
              Explore Features
            </Button>
          </div>

          {/* Interactive Visual Workspace Preview Mockup */}
          <div
            style={{
              maxWidth: '1060px',
              margin: '0 auto',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-xl), var(--shadow-glow-violet)',
              textAlign: 'left',
            }}
          >
            {/* Mock Header Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                backgroundColor: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
                  <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-heading)' }}>
                    algorithms-practice-lab
                  </strong>
                  <Badge variant="cyan">Join Code: algo-9921</Badge>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Badge variant="green" icon={<CheckCircle2 size={12} />}>
                  Connected
                </Badge>
                <Badge variant="violet">👑 Role: Driver</Badge>
              </div>
            </div>

            {/* Mock Workspace Split View */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 280px',
                minHeight: '380px',
                backgroundColor: 'var(--bg-main)',
              }}
              className="workspace-preview-grid"
            >
              {/* Editor + Terminal Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)' }}>
                {/* Editor Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 16px',
                    backgroundColor: 'var(--bg-card)',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Code2 size={15} color="var(--accent-cyan)" />
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>main.py</span>
                    <Badge variant="green">Python 3.11</Badge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--success-green)', fontSize: '0.75rem', fontWeight: 600 }}>
                      ✍️ Driver Editing Active
                    </span>
                  </div>
                </div>

                {/* Editor Lines Mock */}
                <div
                  style={{
                    flex: 1,
                    padding: '16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    lineHeight: '1.7',
                    color: 'var(--text-main)',
                    backgroundColor: 'var(--bg-surface)',
                    overflow: 'hidden',
                  }}
                >
                  <div><span style={{ color: '#94a3b8' }}>01 </span><span style={{ color: '#7c3aed', fontWeight: 600 }}>def</span> <span style={{ color: '#0284c7', fontWeight: 600 }}>binary_search</span>(arr, target):</div>
                  <div><span style={{ color: '#94a3b8' }}>02 </span>    left, right = <span style={{ color: '#d97706' }}>0</span>, <span style={{ color: '#7c3aed' }}>len</span>(arr) - <span style={{ color: '#d97706' }}>1</span></div>
                  <div><span style={{ color: '#94a3b8' }}>03 </span>    <span style={{ color: '#7c3aed', fontWeight: 600 }}>while</span> left &lt;= right:</div>
                  <div><span style={{ color: '#94a3b8' }}>04 </span>        mid = (left + right) // <span style={{ color: '#d97706' }}>2</span></div>
                  <div><span style={{ color: '#94a3b8' }}>05 </span>        <span style={{ color: '#7c3aed', fontWeight: 600 }}>if</span> arr[mid] == target:</div>
                  <div><span style={{ color: '#94a3b8' }}>06 </span>            <span style={{ color: '#7c3aed', fontWeight: 600 }}>return</span> mid</div>
                  <div><span style={{ color: '#94a3b8' }}>07 </span>        <span style={{ color: '#7c3aed', fontWeight: 600 }}>elif</span> arr[mid] &lt; target: left = mid + <span style={{ color: '#d97706' }}>1</span></div>
                  <div><span style={{ color: '#94a3b8' }}>08 </span>        <span style={{ color: '#7c3aed', fontWeight: 600 }}>else</span>: right = mid - <span style={{ color: '#d97706' }}>1</span></div>
                  <div><span style={{ color: '#94a3b8' }}>09 </span>    <span style={{ color: '#7c3aed', fontWeight: 600 }}>return</span> -<span style={{ color: '#d97706' }}>1</span></div>
                  <div><span style={{ color: '#94a3b8' }}>10 </span></div>
                  <div><span style={{ color: '#94a3b8' }}>11 </span>print(<span style={{ color: '#16a34a' }}>&quot;Target Index:&quot;</span>, binary_search([<span style={{ color: '#d97706' }}>1, 3, 5, 7, 9</span>], <span style={{ color: '#d97706' }}>7</span>))</div>
                </div>

                {/* Terminal Preview */}
                <div
                  style={{
                    height: '130px',
                    backgroundColor: 'var(--bg-elevated)',
                    borderTop: '1px solid var(--border-medium)',
                    padding: '10px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <TerminalIcon size={14} color="var(--accent-cyan)" />
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Isolated Container Output</span>
                      <Badge variant="green">Completed &bull; 92ms</Badge>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Exit Code: 0</span>
                  </div>
                  <div style={{ color: 'var(--success-green)' }}>
                    &gt; Target Index: 3
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>
                    Sandboxed container destroyed successfully. Memory: 14MB / 128MB.
                  </div>
                </div>
              </div>

              {/* Sidebar Preview */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Active Participants (3)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-elevated)' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>alex (You)</span>
                      <Badge variant="violet">Driver</Badge>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>sarah_dev</span>
                      <Badge variant="neutral">Viewer</Badge>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>marcus_k</span>
                      <Badge variant="neutral">Viewer</Badge>
                    </div>
                  </div>
                </div>

                <div style={{ flex: 1, borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Room Chat
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
                    <div>
                      <strong style={{ color: 'var(--accent-cyan)' }}>sarah_dev:</strong>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>Edge cases checked!</span>
                    </div>
                    <div>
                      <strong style={{ color: 'var(--primary-violet)' }}>alex:</strong>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>Running test case now.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights Section */}
      <section
        id="features-section"
        style={{
          padding: '80px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <Badge variant="violet" icon={<Zap size={12} />}>
            Capabilities
          </Badge>
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 700,
              margin: '12px 0 16px',
            }}
          >
            Engineered for Serious Collaborative Coding
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto', fontSize: '1.05rem' }}>
            Built specifically for pair programming, technical interview assessments, team debugging, and computer science workshops.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '24px',
          }}
        >
          {/* Card 1 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
              transition: 'transform var(--transition-fast), border-color var(--transition-fast)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--primary-violet-subtle)',
                color: 'var(--primary-violet)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <Zap size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              Real-Time Collaborative Coding
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Low-latency document synchronization via persistent Socket.IO sessions. Code edits, cursor tracking, and language changes replicate instantaneously across all participants.
            </p>
          </div>

          {/* Card 2 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--accent-cyan-subtle)',
                color: 'var(--accent-cyan)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <Users size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              Designated Driver & Viewers
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Prevents cursor collisions and accidental overwrites. The active Driver holds exclusive edit and execution rights, with seamless transfer controls to pass the keyboard anytime.
            </p>
          </div>

          {/* Card 3 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--success-green-subtle)',
                color: 'var(--success-green)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <Shield size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              Isolated Linux Sandboxing
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Code executes in ephemeral, resource-constrained Docker containers. Zero network egress, hard CPU/memory ceilings, and automated cleanup protect against untrusted script execution.
            </p>
          </div>

          {/* Card 4 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--warning-amber-subtle)',
                color: 'var(--warning-amber)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <TerminalIcon size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              Live Terminal & Stdout Broadcast
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              When the Driver triggers a run, BullMQ dispatches the job and stdout/stderr stream directly back to all room members simultaneously in the built-in terminal.
            </p>
          </div>

          {/* Card 5 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--primary-violet-subtle)',
                color: 'var(--primary-violet)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <MessageSquare size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              In-Room Chat & Typing Indicators
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Communicate inline with teammates without switching context. Real-time typing indicators let you know when peers are formulating ideas or suggestions.
            </p>
          </div>

          {/* Card 6 */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--accent-cyan-subtle)',
                color: 'var(--accent-cyan)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <Lock size={22} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', margin: '0 0 10px' }}>
              Private Rooms & 128-Bit Keys
            </h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Lock sensitive sessions behind private cryptographic invite tokens. Control who joins your workspace with persistent membership and rotation keys.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section
        id="how-it-works-section"
        style={{
          padding: '80px 24px',
          backgroundColor: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}>
          <Badge variant="cyan">Simple Workflow</Badge>
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 4vw, 2.75rem)',
              fontWeight: 700,
              margin: '12px 0 48px',
            }}
          >
            How CodeCollab Works
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '32px',
              textAlign: 'left',
            }}
          >
            <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-medium)' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--primary-violet)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  marginBottom: '16px',
                }}
              >
                1
              </div>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.15rem', margin: '0 0 8px' }}>
                Create or Join a Room
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, lineHeight: 1.6 }}>
                Spin up a collaborative workspace in seconds. Share the unique join code or direct invitation URL with peers or candidates.
              </p>
            </div>

            <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-medium)' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent-cyan)',
                  color: '#0a0d14',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  marginBottom: '16px',
                }}
              >
                2
              </div>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.15rem', margin: '0 0 8px' }}>
                Collaborate with Role Guardrails
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, lineHeight: 1.6 }}>
                The active Driver writes code with full Monaco autocomplete. Viewers watch in real time, discuss in chat, and can be promoted to Driver with one click.
              </p>
            </div>

            <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-medium)' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--success-green)',
                  color: '#0a0d14',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  marginBottom: '16px',
                }}
              >
                3
              </div>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.15rem', margin: '0 0 8px' }}>
                Execute in Container Sandbox
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, lineHeight: 1.6 }}>
                Hit Run Code to spin up an isolated Docker container. Output, timing, and errors broadcast immediately back to the entire room.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Technology Stack Section */}
      <section style={{ padding: '80px 24px', maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
        <Badge variant="neutral">Architecture</Badge>
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(2rem, 3.5vw, 2.5rem)',
            fontWeight: 700,
            margin: '12px 0 40px',
          }}
        >
          Built with Modern Engineering Standards
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
          }}
        >
          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--primary-violet)', fontWeight: 700, marginBottom: '6px' }}>Dockerode & MicroVMs</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ephemeral Sandboxed Containers</div>
          </div>

          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: '6px' }}>BullMQ & Redis</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Asynchronous Execution Queues</div>
          </div>

          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--success-green)', fontWeight: 700, marginBottom: '6px' }}>Socket.IO</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Bidirectional Real-Time Events</div>
          </div>

          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--warning-amber)', fontWeight: 700, marginBottom: '6px' }}>Monaco Editor</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>VS Code Professional Editor Engine</div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section
        style={{
          padding: '60px 24px 80px',
          maxWidth: '1000px',
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 'var(--radius-xl)',
            padding: '48px 32px',
            boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07))',
          }}
        >
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', fontWeight: 700, margin: '0 0 12px', color: '#0F172A' }}>
            Ready to Build and Collaborate?
          </h2>
          <p style={{ color: '#475569', maxWidth: '520px', margin: '0 auto 28px', fontSize: '1rem' }}>
            Join thousands of developers using CodeCollab for real-time pair programming and sandboxed execution.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <Button size="lg" variant="primary" onClick={onStartCoding}>
              Get Started for Free
            </Button>
            {onLogin && (
              <Button size="lg" variant="outline" onClick={onLogin}>
                Sign In to Account
              </Button>
            )}
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 768px) {
          .workspace-preview-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

export default LandingPage;
