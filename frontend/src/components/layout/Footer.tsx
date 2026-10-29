import React from 'react';
import { Code2, ShieldCheck, Cpu, Terminal, Users } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '48px 24px 32px',
        color: 'var(--text-muted)',
        fontSize: '0.875rem',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '36px',
          marginBottom: '40px',
        }}
      >
        {/* Brand column */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, var(--primary-violet) 0%, #4f46e5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Code2 size={18} color="#ffffff" />
            </div>
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.2rem',
                fontWeight: 700,
                color: 'var(--text-main)',
              }}
            >
              Code<span style={{ color: 'var(--accent-cyan)' }}>Collab</span>
            </span>
          </div>
          <p style={{ margin: '0 0 16px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
            High-performance collaborative coding platform with real-time driver/viewer synchronization, isolated container sandboxing, and interactive execution.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--success-green)',
                boxShadow: '0 0 8px var(--success-green)',
              }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 500 }}>
              Architecture: MicroVM & Docker Sandbox
            </span>
          </div>
        </div>

        {/* Core Architecture */}
        <div>
          <h4
            style={{
              margin: '0 0 16px',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.95rem',
              fontWeight: 600,
            }}
          >
            System Architecture
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={16} color="var(--primary-violet)" />
              <span>Isolated Dockerode Execution</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} color="var(--accent-cyan)" />
              <span>BullMQ & Redis Task Queuing</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={16} color="var(--success-green)" />
              <span>Monaco Editor Integration</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={16} color="var(--warning-amber)" />
              <span>Real-Time Socket.IO Synchronization</span>
            </li>
          </ul>
        </div>

        {/* Resources & Links */}
        <div>
          <h4
            style={{
              margin: '0 0 16px',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-heading)',
              fontSize: '0.95rem',
              fontWeight: 600,
            }}
          >
            Supported Runtimes
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li>
              <strong style={{ color: 'var(--text-main)' }}>Python 3.11:</strong> Active Container Sandbox
            </li>
            <li style={{ color: 'var(--text-dim)' }}>
              <strong>Java 17:</strong> Compilation Pipeline (Coming Soon)
            </li>
            <li style={{ color: 'var(--text-dim)' }}>
              <strong>C++ (GCC 12):</strong> Sandboxed Runner (Coming Soon)
            </li>
            <li style={{ color: 'var(--text-dim)' }}>
              <strong>JavaScript (Node.js):</strong> Editor Preview
            </li>
          </ul>
        </div>
      </div>

      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          paddingTop: '24px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '0.8rem' }}>
          &copy; {new Date().getFullYear()} CodeCollab. All rights reserved. Built for real-time developer collaboration.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.8rem' }}>
          <span>Version 1.0.0</span>
          <span>&bull;</span>
          <span>Zero Third-Party Compiler APIs</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
