import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Terminal, Code2, LogOut, User as UserIcon, Menu, X, LayoutDashboard, Sparkles } from 'lucide-react';
import Button from '../ui/Button';

interface NavbarProps {
  onNavigate?: (route: string) => void;
  activeRoute?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate, activeRoute = '/' }) => {
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const handleNav = (route: string) => {
    setMobileMenuOpen(false);
    setUserDropdownOpen(false);
    if (onNavigate) {
      onNavigate(route);
    } else if (typeof window !== 'undefined') {
      window.location.pathname = route;
    }
  };

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 24px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Brand */}
      <div
        onClick={() => handleNav('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, var(--primary-violet) 0%, #4f46e5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-glow-violet)',
          }}
        >
          <Code2 size={20} color="#ffffff" />
        </div>
        <div>
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.25rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-main)',
            }}
          >
            Code<span style={{ color: 'var(--accent-cyan)' }}>Collab</span>
          </span>
        </div>
      </div>

      {/* Desktop Navigation Links */}
      <div
        style={{
          display: 'none',
          alignItems: 'center',
          gap: '24px',
        }}
        className="desktop-nav"
      >
        <button
          onClick={() => handleNav('/')}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: 500,
            color: activeRoute === '/' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'color var(--transition-fast)',
          }}
        >
          Overview
        </button>

        <button
          onClick={() => {
            const el = document.getElementById('features-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
            else handleNav('/#features');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: 500,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'color var(--transition-fast)',
          }}
        >
          Features
        </button>

        <button
          onClick={() => {
            const el = document.getElementById('how-it-works-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
            else handleNav('/#how-it-works');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: 500,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'color var(--transition-fast)',
          }}
        >
          How It Works
        </button>

        {isAuthenticated && (
          <button
            onClick={() => handleNav('/dashboard')}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '0.9rem',
              fontWeight: 500,
              color: activeRoute === '/dashboard' ? 'var(--primary-violet)' : 'var(--text-main)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </button>
        )}
      </div>

      {/* Auth Actions (Desktop) */}
      <div style={{ display: 'none', alignItems: 'center', gap: '12px' }} className="desktop-nav">
        {isAuthenticated && user ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-full)',
                color: 'var(--text-main)',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--primary-violet-subtle)',
                  color: 'var(--primary-violet)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                }}
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontWeight: 600 }}>{user.username}</span>
            </button>

            {userDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '8px',
                  width: '200px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-xl)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  zIndex: 60,
                }}
              >
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {user.username}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.email}
                  </div>
                </div>

                <button
                  onClick={() => handleNav('/dashboard')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <LayoutDashboard size={16} />
                  <span>Dashboard</span>
                </button>

                <button
                  onClick={() => handleNav('/profile')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <UserIcon size={16} />
                  <span>Profile & Settings</span>
                </button>

                <button
                  id="nav-logout-btn"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    logout();
                    handleNav('/');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--danger-red)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <LogOut size={16} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => handleNav('/login')}>
              Sign In
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Sparkles size={15} />}
              onClick={() => handleNav('/register')}
            >
              Start Coding
            </Button>
          </>
        )}
      </div>

      {/* Mobile Menu Toggle Button */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle navigation menu"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-main)',
          cursor: 'pointer',
          padding: '6px',
          display: 'none',
        }}
        className="mobile-nav-toggle"
      >
        {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          style={{
            position: 'fixed',
            top: '64px',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--bg-main)',
            borderTop: '1px solid var(--border-subtle)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            zIndex: 49,
          }}
        >
          <button
            onClick={() => handleNav('/')}
            style={{
              padding: '12px',
              textAlign: 'left',
              fontSize: '1rem',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-main)',
            }}
          >
            Overview
          </button>
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              const el = document.getElementById('features-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              padding: '12px',
              textAlign: 'left',
              fontSize: '1rem',
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-main)',
            }}
          >
            Features
          </button>

          {isAuthenticated ? (
            <>
              <button
                onClick={() => handleNav('/dashboard')}
                style={{
                  padding: '12px',
                  textAlign: 'left',
                  fontSize: '1rem',
                  fontWeight: 600,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--primary-violet)',
                }}
              >
                Dashboard
              </button>
              <button
                onClick={() => handleNav('/profile')}
                style={{
                  padding: '12px',
                  textAlign: 'left',
                  fontSize: '1rem',
                  fontWeight: 600,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-main)',
                }}
              >
                Profile & Settings
              </button>
              <button
                onClick={() => {
                  logout();
                  handleNav('/');
                }}
                style={{
                  padding: '12px',
                  textAlign: 'left',
                  fontSize: '1rem',
                  fontWeight: 600,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--danger-red)',
                }}
              >
                Sign Out
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
              <Button variant="outline" size="lg" onClick={() => handleNav('/login')}>
                Sign In
              </Button>
              <Button variant="primary" size="lg" onClick={() => handleNav('/register')}>
                Start Coding
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Style for responsive visibility */}
      <style>{`
        @media (min-width: 768px) {
          .desktop-nav {
            display: flex !important;
          }
          .mobile-nav-toggle {
            display: none !important;
          }
        }
        @media (max-width: 767px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-nav-toggle {
            display: flex !important;
          }
        }
      `}</style>
    </nav>
  );
};

export default Navbar;
