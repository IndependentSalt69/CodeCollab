import React, { useEffect, useState, useRef } from 'react';
import {
  initClientSocket,
  resetClientSocket,
} from '../../realtime/client/socket';
import {
  SOCKET_EVENTS,
} from '../../realtime/client/events';
import CodeEditor from './components/editor/CodeEditor';
import Terminal from './components/terminal/Terminal';
import ChatPanel from './components/chat/ChatPanel';
import VoicePanel from './components/voice/VoicePanel';
import { applyTerminalEvent, terminalRequest, TerminalEvent, TerminalRequestError } from './services/interactiveTerminal';
import { ExecutionResult, ExecutionStatus } from './types/execution';
import { Room } from './types/room';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/Login/LoginPage';
import SignupPage from './pages/Signup/SignupPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import LandingPage from './pages/Landing/LandingPage';
import ProfilePage from './pages/Profile/ProfilePage';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import { useToast } from './context/ToastContext';
import { API_BASE_URL, REALTIME_URL } from './services/apiConfig';

type RoomMember = {
  socketId: string;
  user?: { name?: string; username?: string; _id?: string };
};

type ActivityItem = {
  id: string;
  text: string;
  timestamp: string;
};

const DEFAULT_PYTHON_CODE = `# Welcome to CodeCollab!
# Active Driver can write and execute Python code in an isolated container sandbox.

def compute_fibonacci(n):
    sequence = []
    a, b = 0, 1
    for _ in range(n):
        sequence.append(a)
        a, b = b, a + b
    return sequence

fib_10 = compute_fibonacci(10)
print("CodeCollab Python Execution Sandbox")
print(f"First 10 Fibonacci numbers: {fib_10}")
print(f"Sum of sequence: {sum(fib_10)}")
`;

export default function App() {
  const {
    user: authUser,
    token: authToken,
    isAuthenticated,
    isLoading: authLoading,
    logout,
  } = useAuth();

  const toast = useToast();
  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup'>('landing');
  const [currentView, setCurrentView] = useState<'dashboard' | 'profile' | 'landing'>('dashboard');
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);

  const [backendStatus, setBackendStatus] = useState<string>('checking...');
  const [socketStatus, setSocketStatus] = useState<string>('disconnected');
  const [roomStatus, setRoomStatus] = useState<string>('not joined');
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [transferStatus, setTransferStatus] = useState<string>('');

  // Editor state
  const [code, setCode] = useState<string>(DEFAULT_PYTHON_CODE);
  const [language, setLanguage] = useState<string>('python');

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);

  const [copiedRoomCode, setCopiedRoomCode] = useState<boolean>(false);

  const socketRef = useRef<any>(null);
  const isIncomingUpdateRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleNav = (route: string) => {
    if (!isAuthenticated) {
      if (route === '/login') {
        setAuthView('login');
      } else if (route === '/register' || route === '/signup') {
        setAuthView('signup');
      } else {
        setAuthView('landing');
      }
      return;
    }

    if (route === '/profile') {
      if (activeRoom) {
        handleLeaveRoom();
      }
      setCurrentView('profile');
    } else if (route === '/dashboard') {
      if (activeRoom) {
        handleLeaveRoom();
      }
      setCurrentView('dashboard');
    } else if (route === '/' || route === '/overview') {
      if (activeRoom) {
        handleLeaveRoom();
      }
      setCurrentView('landing');
    }
  };

  const roomId = activeRoom ? activeRoom.roomId : '';
  const isDriver = Boolean(myId && driverId === myId);
  const isLanguageExecutable = ['python', 'cpp', 'java'].includes(language);

  const addActivity = (text: string) => {
    const newItem: ActivityItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setActivityFeed((prev) => [newItem, ...prev].slice(0, 20));
  };

  const emitEditorChange = (newCode: string, newLang: string) => {
    if (!socketRef.current || !socketRef.current.connected || !roomId) return;
    socketRef.current.emit(
      SOCKET_EVENTS.EDITOR.CHANGE,
      {
        roomId,
        code: newCode,
        language: newLang,
      },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) {
          console.warn('editor:change rejected by server:', res?.error);
        }
      }
    );
  };

  const handleCodeChange = (newCode: string | undefined) => {
    const nextVal = newCode || '';
    setCode(nextVal);

    if (isIncomingUpdateRef.current) {
      return;
    }

    if (!isDriver) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      emitEditorChange(nextVal, language);
    }, 250);
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    if (isDriver) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      emitEditorChange(code, newLang);
    }
  };

  const terminalSequence = useRef(0);
  const [terminalOwned, setTerminalOwned] = useState(false);
  const terminalSession = useRef<string | null>(null);
  const retiredSessions = useRef(new Set<string>());
  const handleRunCode = async () => {
    if (!isDriver || !roomId || isExecuting) return;
    terminalSequence.current = 0;
    const previousSession = terminalSession.current;
    setIsExecuting(true);
    setExecutionResult({ status: 'queued', stdout: '', stderr: '', roomId, language, segments: [] });
    const response = await terminalRequest(socketRef.current, 'start', { roomId, language, code, stdin: '', timeout: 10000 });
    if (!response?.ok) {
      if (response?.uncertain && terminalSession.current !== previousSession) {
        setExecutionResult(previous => previous ? { ...previous, inputClosed: true, error: response.error } : previous);
        return;
      }
      setIsExecuting(false);
      setExecutionResult({ status: 'failed', stdout: '', stderr: '', error: response?.error || 'Unable to start execution' });
    }
  };
  const handleTerminalAction = async (action: 'input' | 'eof' | 'cancel', data?: string) => {
    const id = terminalSession.current;
    if (!id) throw Error('No active execution session');
    const response = await terminalRequest(socketRef.current, action, { sessionId: id, seq: terminalSequence.current + 1, ...(data !== undefined ? { data } : {}) });
    if (id !== terminalSession.current) return;
    if (!response?.ok) {
      if (response?.uncertain) setExecutionResult(previous => previous ? { ...previous, inputClosed: true } : previous);
      throw new TerminalRequestError(response?.error || 'Terminal request failed', response?.uncertain === true);
    }
    terminalSequence.current = response.seq;
    if (action !== 'input') setExecutionResult(previous => previous ? { ...previous, inputClosed: true } : previous);
  };
  const handleClearTerminal = () => {
    setExecutionResult(previous => previous ? { ...previous, stdout: '', stderr: '', segments: [], error: undefined } : null);
  };
  const handleLeaveRoom = () => {
    if (socketRef.current && socketRef.current.connected && roomId) {
      socketRef.current.emit(SOCKET_EVENTS.ROOM.LEAVE, {
        roomId,
        user: {
          id: authUser?.id,
          name: authUser?.username,
          username: authUser?.username,
        },
      });
    }
    resetClientSocket();
    setActiveRoom(null);
    setRoomMembers([]);
    setActivityFeed([]);
    setDriverId(null);
    setExecutionResult(null);
    terminalSession.current = null;
    terminalSequence.current = 0;
    retiredSessions.current.clear();
    setTerminalOwned(false);
    setIsExecuting(false);
    setRoomStatus('not joined');
    setSocketStatus('disconnected');
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    handleLeaveRoom();
    logout();
    setAuthView('landing');
    setCurrentView('dashboard');
    toast.addToast('Signed out successfully', 'info', 2500);
  };

  // Synchronize language and starter code when room changes
  useEffect(() => {
    if (activeRoom) {
      if (activeRoom.language) {
        setLanguage(activeRoom.language);
      }
      if (activeRoom.currentCode) {
        setCode(activeRoom.currentCode);
      }
    }
  }, [activeRoom]);

  // Connect and manage Socket.IO session for active room
  useEffect(() => {
    if (!isAuthenticated || !activeRoom) return;

    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.status || 'connected'))
      .catch(() => setBackendStatus('offline'));

    // Authenticated socket connection with JWT
    const socket = initClientSocket(REALTIME_URL, {
      auth: { token: authToken },
    });
    socketRef.current = socket;

    const userPayload = {
      id: authUser?.id,
      name: authUser?.username,
      username: authUser?.username,
      email: authUser?.email,
    };

    const handleConnect = () => {
      console.log('Socket connected:', socket.id);
      setSocketStatus('connected');
      if (socket.id) {
        setMyId(socket.id);
      }

      socket.emit(
        SOCKET_EVENTS.ROOM.JOIN,
        {
          roomId,
          user: userPayload,
          token: authToken,
        },
        (response: {
          ok: boolean;
          roomId?: string;
          socketId?: string;
          error?: string;
        }) => {
          if (response?.ok) {
            setRoomStatus(`joined: ${response.roomId}`);
          } else {
            setRoomStatus(`join failed: ${response?.error || 'unknown error'}`);
          }
        }
      );
    };

    const handleDisconnect = (reason: string) => {
      console.log('Socket disconnected:', reason);
      setSocketStatus('disconnected');
      setIsExecuting(false);
      setExecutionResult(previous => previous?.sessionId ? { ...previous, status: 'cancelled', inputClosed: true, error: 'Connection lost; execution cancelled' } : previous);
      setRoomStatus('not joined');
      setRoomMembers([]);
      setDriverId(null);
    };

    const handleConnectError = (error: Error) => {
      console.error('Socket connection error:', error.message);
      setSocketStatus('error');
    };

    const handleMembers = (snapshot: { roomId: string; members: RoomMember[] }) => {
      if (snapshot.roomId === roomId) {
        setRoomMembers(snapshot.members.filter((member) => member.socketId !== socket.id));
      }
    };

    const handleUserJoined = (member: RoomMember) => {
      if (member.socketId !== socket.id) {
        const userName = member.user?.name || member.user?.username || member.socketId;
        setRoomMembers((current) =>
          [...current.filter((existing) => existing.socketId !== member.socketId), member]
        );
        addActivity(`🟢 ${userName} joined the room`);
        toast.addToast(`${userName} joined the room`, 'info', 2500);
      }
    };

    const handleUserLeft = (member: RoomMember) => {
      if (member.socketId !== socket.id) {
        const userName = member.user?.name || member.user?.username || member.socketId;
        setRoomMembers((current) =>
          current.filter((m) => m.socketId !== member.socketId)
        );
        addActivity(`🔴 ${userName} left the room`);
        toast.addToast(`${userName} left the room`, 'info', 2500);
      }
    };

    const handleDriverUpdated = (payload: { driverId: string; roomId?: string }) => {
      console.log('Driver updated:', payload.driverId);
      setDriverId(payload.driverId);
    };

    const handleEditorUpdate = (payload: {
      code: string;
      language: string;
      cursor?: object;
      updatedBy: string;
    }) => {
      if (payload.updatedBy === socket.id) return;

      isIncomingUpdateRef.current = true;
      if (payload.code !== undefined) {
        setCode(payload.code);
      }
      if (payload.language) {
        setLanguage(payload.language);
      }
      setTimeout(() => {
        isIncomingUpdateRef.current = false;
      }, 50);
    };

    // Execution Realtime Event Handlers
    const handleTerminalEvent = (event: TerminalEvent) => {
      if (event.roomId !== roomId || retiredSessions.current.has(event.sessionId)) return;
      if (event.type === 'status' && event.status === 'queued') {
        if (terminalSession.current && terminalSession.current !== event.sessionId) {
          retiredSessions.current.add(terminalSession.current);
          if (retiredSessions.current.size > 32) retiredSessions.current.delete(retiredSessions.current.values().next().value!);
        }
        terminalSession.current = event.sessionId;
        setTerminalOwned(event.canControl === true);
        terminalSequence.current = 0;
        setIsExecuting(true);
      }
      if (event.sessionId !== terminalSession.current) return;
      setExecutionResult(previous => applyTerminalEvent(previous, event, roomId));
      if (event.type === 'finished') {
        setIsExecuting(false);
        addActivity(`Execution ${event.status}`);
        if (event.status === 'completed') {
          toast.addToast('Execution completed successfully', 'success', 3000);
        } else if (event.status === 'failed' || event.status === 'timeout') {
          toast.addToast(`Execution ${event.status}`, 'error', 3500);
        }
      }
    };
    socket.on('terminal:event', handleTerminalEvent);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on(SOCKET_EVENTS.ROOM.MEMBERS, handleMembers);
    socket.on(SOCKET_EVENTS.ROOM.USER_JOINED, handleUserJoined);
    socket.on(SOCKET_EVENTS.ROOM.USER_LEFT, handleUserLeft);
    socket.on(SOCKET_EVENTS.EDITOR.DRIVER_UPDATED, handleDriverUpdated);
    socket.on(SOCKET_EVENTS.EDITOR.UPDATE, handleEditorUpdate);

    if (!socket.connected) {
      socket.connect();
    } else {
      handleConnect();
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      socket.off('terminal:event', handleTerminalEvent);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off(SOCKET_EVENTS.ROOM.MEMBERS, handleMembers);
      socket.off(SOCKET_EVENTS.ROOM.USER_JOINED, handleUserJoined);
      socket.off(SOCKET_EVENTS.ROOM.USER_LEFT, handleUserLeft);
      socket.off(SOCKET_EVENTS.EDITOR.DRIVER_UPDATED, handleDriverUpdated);
      socket.off(SOCKET_EVENTS.EDITOR.UPDATE, handleEditorUpdate);

      if (socket.connected) {
        socket.emit(SOCKET_EVENTS.ROOM.LEAVE, {
          roomId,
          user: userPayload,
        });
      }
      socket.disconnect();
    };
  }, [isAuthenticated, authToken, activeRoom]);

  const handleTransferDriver = (targetSocketId: string) => {
    if (!socketRef.current || !isDriver || !roomId) return;
    setTransferStatus('Transferring...');
    socketRef.current.emit(
      SOCKET_EVENTS.EDITOR.DRIVER_CHANGE,
      { roomId, newDriverId: targetSocketId },
      (res: { ok: boolean; driverId?: string; error?: string }) => {
        if (res?.ok) {
          setTransferStatus(`Transferred to ${targetSocketId}`);
          toast.addToast('Driver role transferred successfully', 'success', 3000);
        } else {
          setTransferStatus(`Transfer failed: ${res?.error || 'Unknown error'}`);
          toast.addToast(`Transfer failed: ${res?.error || 'Unknown error'}`, 'error', 3000);
        }
      }
    );
  };

  const handleCopyActiveRoomCode = () => {
    if (activeRoom) {
      navigator.clipboard?.writeText(activeRoom.roomId);
      setCopiedRoomCode(true);
      toast.addToast(`Room code copied: ${activeRoom.roomId}`, 'success', 2500);
      setTimeout(() => setCopiedRoomCode(false), 2000);
    }
  };

  // 1. Session Restoration Loading View
  if (authLoading) {
    return (
      <div
        id="auth-loading-spinner"
        style={{
          fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          backgroundColor: 'var(--bg-main, #11131b)',
          color: 'var(--text-muted, #64748b)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⚡</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main, #f4f5fa)' }}>Loading CodeCollab...</div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted, #94a3b8)', marginTop: '6px' }}>Restoring authenticated session</div>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated View (Landing / Login / Signup)
  if (!isAuthenticated) {
    if (authView === 'landing') {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
          <Navbar onNavigate={handleNav} activeRoute="/" />
          <main style={{ flex: 1 }}>
            <LandingPage
              onStartCoding={() => setAuthView('signup')}
              onLogin={() => setAuthView('login')}
              onExploreFeatures={() => {
                const el = document.getElementById('features-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          </main>
          <Footer />
        </div>
      );
    }

    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
        <Navbar onNavigate={handleNav} activeRoute={authView === 'login' ? '/login' : '/register'} />
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '2.5rem 1rem',
            fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
          }}
        >
          <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '2.2rem', fontWeight: 800, margin: 0, color: 'var(--text-main, #0f172a)', fontFamily: 'var(--font-heading)' }}>
              Code<span style={{ color: 'var(--accent-cyan)' }}>Collab</span>
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: '0.95rem', color: 'var(--text-muted, #64748b)' }}>
              Real-time collaborative code editor with sandboxed execution
            </p>
          </header>

          <div style={{ width: '100%', maxWidth: '440px' }}>
            {authView === 'login' ? (
              <LoginPage
                onSwitchToSignup={() => setAuthView('signup')}
                onSuccess={() => {
                  toast.addToast('Welcome back!', 'success', 2500);
                }}
              />
            ) : (
              <SignupPage
                onSwitchToLogin={() => setAuthView('login')}
                onSuccess={() => {
                  toast.addToast('Account created successfully!', 'success', 2500);
                }}
              />
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // 3. Authenticated Views (Dashboard / Profile / Landing)
  if (!activeRoom && currentView === 'profile') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
        <Navbar onNavigate={handleNav} activeRoute="/profile" />
        <main style={{ flex: 1 }}>
          <ProfilePage onBackToDashboard={() => setCurrentView('dashboard')} />
        </main>
        <Footer />
      </div>
    );
  }

  if (!activeRoom && currentView === 'landing') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
        <Navbar onNavigate={handleNav} activeRoute="/" />
        <main style={{ flex: 1 }}>
          <LandingPage
            onStartCoding={() => setCurrentView('dashboard')}
            onExploreFeatures={() => {
              const el = document.getElementById('features-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </main>
        <Footer />
      </div>
    );
  }

  if (!activeRoom) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
        <Navbar onNavigate={handleNav} activeRoute="/dashboard" />
        <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1000px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #0f172a)' }}>CodeCollab</h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-muted, #64748b)' }}>
                Real-time collaborative code editor with sandboxed execution
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                id="user-profile-badge"
                onClick={() => setCurrentView('profile')}
                title="View Profile & Settings"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  backgroundColor: 'var(--bg-elevated, #f1f5f9)',
                  border: '1px solid var(--border-medium, #cbd5e1)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: 'var(--text-main, #334155)',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <span>👤</span>
                <strong>{authUser?.username}</strong>
                <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.75rem' }}>({authUser?.email})</span>
              </div>

              <button
                id="logout-btn"
                onClick={handleLogout}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'background-color 0.15s ease',
                }}
              >
                Sign Out
              </button>
            </div>
          </header>

          <DashboardPage onSelectRoom={(room) => setActiveRoom(room)} />
        </main>
        <Footer />
      </div>
    );
  }

  // 4. Authenticated Collaborative Coding Room View
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
      <Navbar onNavigate={handleNav} activeRoute="/room" />
      <div style={{ flex: 1, padding: '1.5rem', maxWidth: '1000px', width: '100%', margin: '0 auto', color: 'var(--text-main, #1e293b)', boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            id="back-to-dashboard-btn"
            onClick={handleLeaveRoom}
            style={{
              padding: '6px 12px',
              fontSize: '0.8rem',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ← Dashboard
          </button>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>{activeRoom.name}</h1>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: '#f1f5f9',
                  color: '#475569',
                  fontFamily: 'monospace',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                Code: {activeRoom.roomId}
                <button
                  onClick={handleCopyActiveRoomCode}
                  title="Copy room code"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: copiedRoomCode ? '#16a34a' : '#64748b',
                    fontWeight: 600,
                  }}
                >
                  {copiedRoomCode ? '✓' : '📋'}
                </button>
              </span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Real-time collaboration session
            </p>
          </div>
        </div>

        {/* User Identity & Logout Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            id="user-profile-badge"
            onClick={() => {
              handleLeaveRoom();
              setCurrentView('profile');
            }}
            title="View Profile & Settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: 'var(--bg-elevated, #f1f5f9)',
              border: '1px solid var(--border-medium, #cbd5e1)',
              borderRadius: '6px',
              fontSize: '0.85rem',
              color: 'var(--text-main, #334155)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <span>👤</span>
            <strong>{authUser?.username}</strong>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>({authUser?.email})</span>
          </div>

          <button
            id="logout-btn"
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              fontSize: '0.8rem',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              transition: 'background-color 0.15s ease',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Status Banner */}
      <div style={{ background: '#f8fafc', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.875rem' }}>
          <div>Backend: <strong>{backendStatus}</strong></div>
          <div>Socket: <strong>{socketStatus}</strong></div>
          <div>Room: <strong>{roomStatus}</strong></div>
          <div>
            Role:{' '}
            <strong style={{ color: isDriver ? '#059669' : '#4f46e5' }}>
              {isDriver ? '👑 Driver (Can Edit & Run)' : '👀 Viewer (Read-Only)'}
            </strong>
          </div>
        </div>
        {transferStatus && <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '6px 0 0' }}>{transferStatus}</p>}
      </div>

      {/* Editor Section */}
      <div style={{ marginBottom: '1.25rem', background: '#ffffff', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        {/* Editor Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Code Editor</h3>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: isDriver ? '#dcfce7' : '#f1f5f9',
                color: isDriver ? '#15803d' : '#475569',
                fontWeight: 600,
              }}
            >
              {isDriver ? '✍️ Editing Enabled' : '🔒 Read-Only (Viewer)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Language Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label htmlFor="lang-select" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Language:</label>
              <select
                id="lang-select"
                value={language}
                disabled={!isDriver || isExecuting}
                onChange={(e) => handleLanguageChange(e.target.value)}
                style={{
                  padding: '5px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  background: !isDriver ? '#f1f5f9' : '#fff',
                  cursor: !isDriver ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="python">Python 3.11 (⚡ Container Sandbox)</option>
                <option value="java">Java 17 (Container Sandbox)</option>
                <option value="cpp">C++17 (Container Sandbox)</option>
              </select>
            </div>

            {/* Run Code Button */}
            <button
              id="run-code-btn"
              onClick={handleRunCode}
              disabled={!isDriver || isExecuting || !isLanguageExecutable}
              title={
                !isDriver
                  ? 'Only the active Driver can run code'
                  : !isLanguageExecutable
                  ? 'Execution supports Python, C++, and Java'
                  : 'Execute code in container sandbox'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#ffffff',
                backgroundColor: !isDriver || !isLanguageExecutable ? '#94a3b8' : isExecuting ? '#eab308' : '#16a34a',
                border: 'none',
                borderRadius: '6px',
                cursor: !isDriver || isExecuting || !isLanguageExecutable ? 'not-allowed' : 'pointer',
                boxShadow: isDriver && !isExecuting && isLanguageExecutable ? '0 1px 2px 0 rgba(0, 0, 0, 0.05)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{isExecuting ? '⏳' : '▶'}</span>
              <span>{isExecuting ? 'Running...' : 'Run Code'}</span>
            </button>
          </div>
        </div>

        <CodeEditor
          value={code}
          language={language}
          readOnly={!isDriver}
          onChange={handleCodeChange}
          height="320px"
        />
      </div>

      {/* Terminal Output Section */}
      <div style={{ marginBottom: '1.25rem' }}>
        <Terminal
          result={executionResult}
          isRunning={isExecuting}
          onClear={handleClearTerminal}
          canControl={isDriver && terminalOwned}
          onInput={text => handleTerminalAction('input', text)}
          onEOF={() => handleTerminalAction('eof')}
          onStop={() => handleTerminalAction('cancel')}
          height="240px"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
        <ChatPanel
          socket={socketStatus === 'connected' ? socketRef.current : null}
          roomId={roomId}
          token={authToken}
          currentUserId={authUser?.id}
          isJoined={roomStatus.startsWith('joined')}
        />
        <VoicePanel roomId={roomId} token={authToken} />

        {/* Active Users Section */}
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem', fontSize: '1.05rem', color: '#0f172a' }}>
            Active Users
          </h3>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {/* Current user */}
            <li
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.6rem 0.8rem',
                marginBottom: '0.5rem',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
              }}
            >
              <span>
                <strong>{authUser?.username || 'You'} (You)</strong>{' '}
                <span>{isDriver ? '👑' : '👀'}</span>
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isDriver ? '#059669' : '#64748b' }}>
                {isDriver ? 'Driver' : 'Viewer'}
              </span>
            </li>

            {/* Other room members */}
            {roomMembers.map((member) => {
              const memberIsDriver = member.socketId === driverId;
              const name = member.user?.name || member.user?.username || member.socketId;
              return (
                <li
                  key={member.socketId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.8rem',
                    marginBottom: '0.5rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                  }}
                >
                  <span>
                    <strong>{name}</strong>{' '}
                    <span>{memberIsDriver ? '👑' : '👀'}</span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: memberIsDriver ? '#059669' : '#64748b' }}>
                      {memberIsDriver ? 'Driver' : 'Viewer'}
                    </span>
                    {isDriver && !memberIsDriver && (
                      <button
                        onClick={() => handleTransferDriver(member.socketId)}
                        style={{
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          background: '#4f46e5',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Transfer
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Recent Activity Feed */}
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem', fontSize: '1.05rem', color: '#0f172a' }}>
            Recent Activity
          </h3>
          {activityFeed.length === 0 ? (
            <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem' }}>No recent activity yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '240px', overflowY: 'auto' }}>
              {activityFeed.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem 0.6rem',
                    borderBottom: '1px solid #f1f5f9',
                    fontSize: '0.875rem',
                  }}
                >
                  <span>{item.text}</span>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{item.timestamp}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </div>
      <Footer />
    </div>
  );
}
