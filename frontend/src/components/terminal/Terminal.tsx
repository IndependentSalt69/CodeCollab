import React, { useEffect, useRef, useState } from 'react';
import { ExecutionResult, ExecutionStatus } from '../../types/execution';
import { TerminalEcho, TerminalRequestError, terminalTranscript } from '../../services/interactiveTerminal';

export interface TerminalProps {
  result: ExecutionResult | null;
  isRunning?: boolean;
  onClear?: () => void;
  className?: string;
  height?: string | number;
  canControl?: boolean;
  onInput?: (text: string) => Promise<void>;
  onEOF?: () => Promise<void>;
  onStop?: () => Promise<void>;
}

const statusBadgeConfig: Record<
  ExecutionStatus,
  { label: string; bg: string; color: string; border: string; icon: string }
> = {
  idle: { label: 'Ready', bg: '#334155', color: '#cbd5e1', border: '#475569', icon: '●' },
  queued: { label: 'Queued', bg: '#3b82f620', color: '#60a5fa', border: '#3b82f640', icon: '⏳' },
  starting: { label: 'Starting...', bg: '#3b82f620', color: '#60a5fa', border: '#3b82f640', icon: '⏳' },
  cancelled: { label: 'Cancelled', bg: '#334155', color: '#cbd5e1', border: '#475569', icon: '■' },
  running: { label: 'Running...', bg: '#eab30820', color: '#facc15', border: '#eab30840', icon: '⚡' },
  completed: { label: 'Completed', bg: '#22c55e20', color: '#4ade80', border: '#22c55e40', icon: '✓' },
  failed: { label: 'Failed', bg: '#ef444420', color: '#f87171', border: '#ef444440', icon: '✕' },
  timeout: { label: 'Timeout', bg: '#f9731620', color: '#fb923c', border: '#f9731640', icon: '⏱' },
};

const TerminalSession: React.FC<TerminalProps> = ({
  result,
  isRunning = false,
  onClear,
  className,
  height = '280px',
  canControl = false,
  onInput,
  onEOF,
  onStop,
}) => {
  const [line, setLine] = useState('');
  const [pending, setPending] = useState(false);
  const [inputError, setInputError] = useState('');
  const [echoes, setEchoes] = useState<TerminalEcho[]>([]);
  const [unknownDelivery, setUnknownDelivery] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const nextEcho = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const segments = result?.segments || [];
  const transcript = terminalTranscript(segments, echoes);

  const currentStatus: ExecutionStatus = result?.status || (isRunning ? 'running' : 'idle');
  const inputAvailable =
    Boolean(result?.sessionId) &&
    canControl &&
    currentStatus === 'running' &&
    !result?.inputClosed && !unknownDelivery;
  const inputOpen = inputAvailable && !pending;

  useEffect(() => {
    if (inputAvailable && !pending) inputRef.current?.focus({ preventScroll: true });
  }, [inputAvailable, pending, result?.sessionId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [result?.segments, echoes, line]);

  const act = async (action: (() => Promise<void>) | undefined) => {
    if (!action || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setInputError('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) setInputError(error instanceof Error ? error.message : 'Terminal action failed');
    } finally {
      busyRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const sendLine = async () => {
    if (!onInput || !inputOpen || busyRef.current) return;
    const submittedLine = line;
    const text = `${submittedLine}\n`;
    if (new TextEncoder().encode(text).length > 4096) {
      setInputError('Input message exceeds 4 KiB including its newline'); return;
    }
    if (echoes.length >= 1024 || new TextEncoder().encode(echoes.map(echo => echo.text).join('') + text).length > 65536) {
      setInputError('Session input limit exceeded'); return;
    }
    const echoedInput: TerminalEcho = { id: ++nextEcho.current, afterSeq: segments[segments.length - 1]?.seq ?? segments.length, text };
    busyRef.current = true;
    setPending(true);
    setInputError('');
    // Echo immediately at the prompt. This keeps the transcript order correct
    // even if the process produces its next output before the socket ack arrives.
    setEchoes(current => [...current, echoedInput]);
    try {
      // The backend forwards this to the existing process; no new run is started.
      await onInput(text);
      if (mounted.current) setLine('');
    } catch (error) {
      if (!mounted.current) return;
      // An uncertain acknowledgement may follow successful delivery. Keep its
      // echo in place and disable retries; only a definite rejection rolls back.
      if (error instanceof TerminalRequestError && error.uncertain) setUnknownDelivery(true);
      else setEchoes(current => current.filter(echo => echo.id !== echoedInput.id));
      setInputError(error instanceof Error ? error.message : 'Could not send program input');
    } finally {
      busyRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const handleClear = () => {
    // Clear the visible transcript only; do not cancel the process.
    setEchoes([]);
    if (!unknownDelivery) setInputError('');
    onClear?.();
  };

  const badge = statusBadgeConfig[currentStatus] || statusBadgeConfig.idle;
  const hasStdout = Boolean(result?.stdout && result.stdout.trim().length > 0);
  const hasStderr = Boolean(result?.stderr && result.stderr.trim().length > 0);
  const hasError = Boolean(result?.error);
  const hasRun = Boolean(result && (result.runId || hasStdout || hasStderr || hasError || result.status !== 'idle'));
  const hasSegmentOutput = Array.isArray(result?.segments);

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #1e293b',
        overflow: 'hidden',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        height,
      }}
    >
      {/* Terminal Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          userSelect: 'none',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>❯_</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.02em' }}>
            Terminal Output
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '9999px',
              backgroundColor: badge.bg,
              color: badge.color,
              border: `1px solid ${badge.border}`,
            }}
          >
            <span>{badge.icon}</span>
            <span>{badge.label}</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {result?.sessionId && (
            <>
              <button onClick={() => void act(onEOF)} disabled={!inputOpen}>
                Send EOF / Close Input
              </button>
              <button onClick={() => void act(onStop)} disabled={!canControl || !isRunning || pending}>
                Stop
              </button>
            </>
          )}
          {result?.executionTimeMs !== undefined && result.executionTimeMs !== null && (
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Duration: <strong style={{ color: '#cbd5e1' }}>{result.executionTimeMs}ms</strong>
            </span>
          )}
          {result?.exitCode !== undefined && result.exitCode !== null && (
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Exit Code:{' '}
              <strong style={{ color: result.exitCode === 0 ? '#4ade80' : '#f87171' }}>{result.exitCode}</strong>
            </span>
          )}
          {onClear && (
            <button
              onClick={handleClear}
              title="Clear terminal output without stopping the program"
              style={{
                background: 'transparent',
                border: '1px solid #475569',
                borderRadius: '4px',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 8px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = '#f8fafc';
                event.currentTarget.style.borderColor = '#64748b';
                event.currentTarget.style.backgroundColor = '#334155';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = '#94a3b8';
                event.currentTarget.style.borderColor = '#475569';
                event.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Terminal transcript. The editable input is rendered inline after the
          latest output chunk, so a prompt such as "Enter a number: " is followed
          immediately by the user's cursor, like a coding-site console. */}
      <div
        ref={bodyRef}
        role="log"
        aria-label="Program output"
        onClick={() => {
          if (inputAvailable) inputRef.current?.focus();
        }}
        style={{
          flex: 1,
          minHeight: 0,
          padding: '12px 16px',
          overflowY: 'auto',
          fontSize: '13px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          cursor: inputAvailable ? 'text' : 'default',
        }}
      >
        {isRunning && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: currentStatus === 'queued' ? '#60a5fa' : '#facc15',
              marginBottom: '8px',
              fontStyle: 'italic',
            }}
          >
            <span>{currentStatus === 'queued' ? '⏳ Queued in worker pool...' : '⚡ Running in isolated container...'}</span>
          </div>
        )}

        {hasError && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#ef444415',
              border: '1px solid #ef444440',
              borderRadius: '6px',
              color: '#f87171',
              marginBottom: '10px',
              fontSize: '12.5px',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>⚠️ Execution Error:</div>
            <div>{result?.error}</div>
          </div>
        )}

        {hasSegmentOutput ? (
          <pre data-testid="terminal-transcript" style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {transcript.map((segment, index) => (
              <span
                key={`${index}-${segment.channel}`}
                data-stream={segment.channel}
                style={{ color: segment.channel === 'stderr' ? '#f87171' : '#f1f5f9' }}
              >
                {segment.text}
              </span>
            ))}
            {result?.sessionId && (
              <input
                ref={inputRef}
                aria-label="Program input"
                title="Type program input and press Enter"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={pending || unknownDelivery ? '' : line}
                onChange={(event) => setLine(event.target.value.replace(/[\r\n]/g, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    void sendLine();
                  }
                }}
                disabled={!inputOpen}
                maxLength={4095}
                style={{
                  display: 'inline-block',
                  width: `${Math.max(1, line.length + 1)}ch`,
                  minWidth: '1ch',
                  maxWidth: '100%',
                  margin: 0,
                  padding: 0,
                  border: 0,
                  borderRadius: 0,
                  outline: 'none',
                  boxShadow: 'none',
                  background: 'transparent',
                  color: '#f1f5f9',
                  caretColor: '#f8fafc',
                  font: 'inherit',
                  lineHeight: 'inherit',
                  verticalAlign: 'baseline',
                }}
              />
            )}
          </pre>
        ) : (
          <>
            {hasStdout && (
              <pre style={{ margin: 0, padding: 0, fontFamily: 'inherit', color: '#f1f5f9', whiteSpace: 'pre-wrap' }}>
                {result?.stdout}
              </pre>
            )}
            {hasStderr && (
              <pre
                style={{
                  margin: hasStdout ? '8px 0 0 0' : 0,
                  padding: 0,
                  fontFamily: 'inherit',
                  color: '#f87171',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {result?.stderr}
              </pre>
            )}
          </>
        )}

        {hasRun && !isRunning && !hasStdout && !hasStderr && !hasError && !echoes.length && (
          <div style={{ color: '#64748b', fontStyle: 'italic' }}>
            (Process finished with exit code {result?.exitCode ?? 0} and produced no console output)
          </div>
        )}
        {!hasRun && !isRunning && (
          <div style={{ color: '#64748b', fontStyle: 'italic' }}>
            Click &quot;Run Code&quot; (Driver only) to execute code in a secure sandboxed container.
            {'\n'}Output and realtime execution status will appear here.
          </div>
        )}
        {inputError && <div role="alert" style={{ color: '#f87171', marginTop: '6px' }}>{inputError}</div>}
      </div>
      {inputAvailable && (
        <div
          style={{
            padding: '4px 14px 8px',
            borderTop: '1px solid #1e293b',
            color: '#94a3b8',
            fontSize: '11px',
          }}
        >
          Type directly after the program prompt and press Enter. The execution deadline still applies while waiting.
        </div>
      )}
    </div>
  );
};

// A new run gets new local drafts/echoes/ack state. An old promise cannot clear
// input or inject an error into a newer session, even if the callback finishes late.
export const Terminal: React.FC<TerminalProps> = props => (
  <TerminalSession key={`${props.result?.roomId || ''}:${props.result?.sessionId || props.result?.runId || ''}`} {...props} />
);

export default Terminal;
