import { useState, useRef, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/* Configuration (mirrors the original CONFIG object)                 */
/* ------------------------------------------------------------------ */
const DURATIONS = {
  pomodoro: 1500,
  short: 300,
  long: 900,
};

const THEME_CLASSES = {
  pomodoro: 'theme-pomodoro',
  short: 'theme-short',
  long: 'theme-long',
};

/* Session label per mode (mirrors the original CONFIG.sessionLabels) */
const SESSION_LABELS = {
  pomodoro: 'Time to focus!',
  short: 'Take a short break.',
  long: 'Enjoy a long break!',
};

/* ------------------------------------------------------------------ */
/* Small class-name helper                                            */
/* ------------------------------------------------------------------ */
function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

function format(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return {
    minutes: String(m).padStart(2, '0'),
    seconds: String(s).padStart(2, '0'),
  };
}

export default function PomodoroApp() {
  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */
  const [mode, setMode] = useState('pomodoro');
  const [timeRemaining, setTimeRemaining] = useState(DURATIONS.pomodoro);
  const [isRunning, setIsRunning] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [removingIds, setRemovingIds] = useState(() => new Set());

  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [kebabOpen, setKebabOpen] = useState(false);

  /* Refs used by the interval callback so it never reads stale values */
  const modeRef = useRef(mode);
  const timeRef = useRef(timeRemaining);
  const pomodorosSinceBreakRef = useRef(0);
  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const nextTaskIdRef = useRef(1);
  const inputRef = useRef(null);

  modeRef.current = mode;
  timeRef.current = timeRemaining;

  /* ---------------------------------------------------------------- */
  /* Side effects mirroring the original DOM manipulation             */
  /* ---------------------------------------------------------------- */

  /* theme.apply() — swap the body theme class when the mode changes */
  useEffect(() => {
    document.body.classList.remove('theme-pomodoro', 'theme-short', 'theme-long');
    document.body.classList.add(THEME_CLASSES[mode]);
  }, [mode]);

  /* body.timer-running toggling (drives the colon pulse animation) */
  useEffect(() => {
    document.body.classList.toggle('timer-running', isRunning);
  }, [isRunning]);

  /* ui.renderTime() also set document.title on every update */
  useEffect(() => {
    const { minutes, seconds } = format(timeRemaining);
    document.title = `${minutes}:${seconds} — Pomodoro`;
  }, [timeRemaining]);

  /* Clean up any running interval on unmount */
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  /* Focus the new-task input when the panel opens (taskInput.show) */
  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  /* Close the kebab menu on any outside click (document click listener) */
  useEffect(() => {
    const onDocClick = () => setKebabOpen(false);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  /* Global Space shortcut to start/pause from anywhere on the page */
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Audio engine — Web Audio API (unchanged three-tone completion)   */
  /* ---------------------------------------------------------------- */
  function playBeep() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;

      const playTone = (freq, startAt, duration) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, ctx.currentTime + startAt);

        gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startAt + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration - 0.02);

        oscillator.start(ctx.currentTime + startAt);
        oscillator.stop(ctx.currentTime + startAt + duration);
      };

      playTone(523.25, 0, 0.3);
      playTone(659.25, 0.35, 0.35);
      playTone(783.99, 0.75, 0.5);
    } catch (err) {
      console.warn('Web Audio API unavailable:', err);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Notification API — fires when a session ends (same trigger as    */
  /* the original completion point). Permission is requested on the   */
  /* first Start press (a user gesture).                              */
  /* ---------------------------------------------------------------- */
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function showCompletionNotification() {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Pomodoro Timer', {
          body: "Time's up! Your session is complete.",
        });
      }
    } catch (err) {
      console.warn('Notification API unavailable:', err);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Timer engine                                                     */
  /* ---------------------------------------------------------------- */
  function start() {
    if (intervalRef.current) return;
    setIsRunning(true);
    requestNotificationPermission();

    intervalRef.current = setInterval(() => {
      /* Original: decrement, render, then complete() when it hits 0.
         The 00:00 frame was overwritten synchronously by complete(), so it
         never painted — we likewise jump straight to completion here. */
      if (timeRef.current <= 1) {
        complete();
      } else {
        const next = timeRef.current - 1;
        timeRef.current = next;
        setTimeRemaining(next);
      }
    }, 1000);
  }

  function toggle() {
    if (intervalRef.current) {
      pauseInterval();
    } else {
      start();
    }
  }

  /* Ref-based stop — reliable even when called from the interval callback
     or the global key handler, where the isRunning state may be stale. */
  function pauseInterval() {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function complete() {
    /* Stop the clock */
    pauseInterval();

    /* Completion sound + browser notification */
    playBeep();
    showCompletionNotification();

    /* Decide the next phase (identical logic to the original) */
    if (modeRef.current === 'pomodoro') {
      pomodorosSinceBreakRef.current += 1;
      if (pomodorosSinceBreakRef.current >= 4) {
        pomodorosSinceBreakRef.current = 0;
        switchMode('long');
      } else {
        switchMode('short');
      }
    } else {
      switchMode('pomodoro');
    }
    /* NOTE (faithful reproduction): the original set document.title to
       "✅ Timer done! — Pomodoro" here with a 3s reset, but that code was
       unreachable (switchMode -> renderAll -> renderSession threw first),
       so it never ran. We omit it to match the observed behavior. */
  }

  function switchMode(newMode) {
    pauseInterval();
    setMode(newMode);
    modeRef.current = newMode;
    timeRef.current = DURATIONS[newMode];
    setTimeRemaining(DURATIONS[newMode]);
  }

  function reset() {
    pauseInterval();
    timeRef.current = DURATIONS[modeRef.current];
    setTimeRemaining(DURATIONS[modeRef.current]);
  }

  /* ---------------------------------------------------------------- */
  /* Mode tab / skip handlers                                         */
  /* ---------------------------------------------------------------- */
  function handleModeClick(newMode) {
    if (newMode !== mode) {
      switchMode(newMode);
    } else {
      reset();
    }
  }

  function handleSkip() {
    let nextMode;
    if (mode === 'pomodoro') {
      const wouldBe = pomodorosSinceBreakRef.current + 1;
      nextMode = wouldBe >= 4 ? 'long' : 'short';
    } else {
      nextMode = 'pomodoro';
    }
    switchMode(nextMode);
  }

  /* ---------------------------------------------------------------- */
  /* Task manager                                                     */
  /* ---------------------------------------------------------------- */
  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task = { id: nextTaskIdRef.current++, text: trimmed, completed: false };
    setTasks((prev) => [...prev, task]);
  }

  function toggleTask(id) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  }

  /* Matches the original fade-out (opacity + translateX) then removal at 200ms */
  function removeTask(id) {
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  }

  function clearCompleted() {
    tasks.filter((t) => t.completed).forEach((t) => removeTask(t.id));
  }

  function markAllCompleted() {
    setTasks((prev) => prev.map((t) => ({ ...t, completed: true })));
  }

  function clearAll() {
    tasks.forEach((t) => removeTask(t.id));
  }

  /* ---------------------------------------------------------------- */
  /* Add-task input panel                                             */
  /* ---------------------------------------------------------------- */
  function showTaskInput() {
    setShowInput(true);
  }

  function hideTaskInput() {
    setShowInput(false);
    setInputValue('');
  }

  function saveTask() {
    const text = inputValue.trim();
    if (text) addTask(text);
    hideTaskInput();
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTask();
    }
    if (e.key === 'Escape') {
      hideTaskInput();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Kebab menu                                                       */
  /* ---------------------------------------------------------------- */
  function toggleKebab(e) {
    e.stopPropagation();
    setKebabOpen((open) => !open);
  }

  const { minutes, seconds } = format(timeRemaining);

  /* ================================================================ */
  /* Render                                                           */
  /* ================================================================ */
  return (
    <main className="w-full max-w-[480px] flex flex-col gap-5">

      {/* ---------------------------- Timer card ---------------------------- */}
      <section
        aria-label="Pomodoro Timer"
        className="relative bg-[var(--bg-card)] rounded-[18px] pt-8 px-8 pb-10 flex flex-col items-center gap-3 backdrop-blur-[8px] border border-white/15 [transition:background_0.4s_ease,border-color_0.4s_ease] max-[480px]:pt-6 max-[480px]:px-5 max-[480px]:pb-8 max-[480px]:rounded-[14px]"
      >

        {/* Mode navigation */}
        <nav
          role="tablist"
          aria-label="Timer modes"
          className="flex gap-1 bg-black/15 rounded-full p-1 mb-2 max-[480px]:flex-wrap max-[480px]:justify-center max-[480px]:rounded-[14px]"
        >
          {[
            { key: 'pomodoro', label: 'Pomodoro', duration: 1500 },
            { key: 'short', label: 'Short Break', duration: 300 },
            { key: 'long', label: 'Long Break', duration: 900 },
          ].map(({ key, label, duration }) => {
            const active = mode === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                aria-controls="timer-display"
                data-mode={key}
                data-duration={duration}
                onClick={() => handleModeClick(key)}
                className={cn(
                  'px-4 py-[0.4rem] rounded-full text-sm font-medium bg-transparent whitespace-nowrap [transition:background_0.25s_ease,color_0.25s_ease] hover:text-[var(--color-accent)] hover:bg-white/10 max-[480px]:text-[0.8rem] max-[480px]:px-[0.85rem] max-[480px]:py-[0.35rem]',
                  active
                    ? 'bg-[var(--color-tab-active-bg)] text-[var(--color-tab-active-text)] font-semibold'
                    : 'text-[var(--color-muted)]'
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {/* Timer display */}
        <div
          id="timer-display"
          role="timer"
          aria-live="polite"
          aria-label="Time remaining"
          className="font-mono text-[clamp(5rem,18vw,7.5rem)] font-bold text-[var(--color-accent)] tracking-[0.04em] leading-none my-2 [transition:color_0.4s_ease] tabular-nums flex items-center gap-0"
        >
          <span>{minutes}</span>
          <span className="colon inline-block mb-[6px]">:</span>
          <span>{seconds}</span>
        </div>

        {/* Session label — updates per mode */}
        <p className="flex flex-col items-center gap-[2px] mb-2">
          <span className="text-[0.95rem] text-[var(--color-session)] font-medium [transition:color_0.4s_ease]">
            {SESSION_LABELS[mode]}
          </span>
        </p>

        {/* Button row */}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={toggle}
            aria-label={isRunning ? 'Pause timer' : 'Start timer'}
            className="flex-1 bg-[var(--color-cta-bg)] text-[var(--color-cta-text)] text-[1.1rem] font-bold tracking-[0.12em] py-[0.9rem] px-6 rounded-[10px] shadow-[0_6px_20px_var(--color-cta-shadow)] [transition:background_0.4s_ease,color_0.4s_ease,transform_0.15s_ease,box-shadow_0.15s_ease] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_var(--color-cta-shadow)] active:translate-y-0 active:scale-[0.98] max-[480px]:text-[1rem] max-[480px]:py-[0.85rem]"
          >
            {isRunning ? 'PAUSE' : 'START'}
          </button>

          <button
            onClick={handleSkip}
            aria-label="Skip to next phase"
            title="Skip to next phase"
            className="w-12 h-12 rounded-[10px] bg-white/[0.18] text-[var(--color-accent)] flex items-center justify-center shrink-0 [transition:background_0.2s_ease,transform_0.15s_ease,color_0.4s_ease] hover:bg-white/[0.28] hover:scale-[1.06] active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
            </svg>
          </button>
        </div>
      </section>

      {/* ---------------------------- Tasks section ---------------------------- */}
      <section aria-label="Task list" className="w-full text-[var(--color-accent)]">

        <header className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold text-[var(--color-accent)] tracking-[0.03em] [transition:color_0.4s_ease]">
            Tasks
          </h2>

          <div className="relative">
            <button
              aria-label="Task options"
              aria-haspopup="true"
              aria-expanded={kebabOpen}
              onClick={toggleKebab}
              className="flex flex-col items-center justify-center gap-[3px] w-8 h-8 rounded-lg bg-[var(--color-task-bg)] border border-[var(--color-task-border)] [transition:background_0.2s_ease] hover:bg-[var(--color-task-hover)]"
            >
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-[var(--color-kebab)] block [transition:background_0.4s_ease]" />
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-[var(--color-kebab)] block [transition:background_0.4s_ease]" />
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-[var(--color-kebab)] block [transition:background_0.4s_ease]" />
            </button>

            <div
              role="menu"
              aria-hidden={!kebabOpen}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'absolute top-[calc(100%+8px)] right-0 min-w-[200px] bg-[var(--bg-card-solid)] border border-white/[0.18] rounded-xl p-1.5 z-50 shadow-[0_12px_36px_rgba(0,0,0,0.35)] origin-top-right [transition:opacity_0.18s_ease,transform_0.18s_ease]',
                kebabOpen
                  ? 'opacity-100 pointer-events-auto translate-y-0 scale-100'
                  : 'opacity-0 pointer-events-none translate-y-[-6px] scale-[0.96]'
              )}
            >
              <button
                role="menuitem"
                onClick={() => { markAllCompleted(); setKebabOpen(false); }}
                className="w-full flex items-center gap-[0.6rem] py-[0.55rem] px-3 rounded-lg bg-transparent text-[var(--color-accent)] text-[0.85rem] font-medium text-left [transition:background_0.15s_ease,color_0.15s_ease] hover:bg-white/[0.12]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                Mark All as Finished
              </button>
              <button
                role="menuitem"
                onClick={() => { clearCompleted(); setKebabOpen(false); }}
                className="w-full flex items-center gap-[0.6rem] py-[0.55rem] px-3 rounded-lg bg-transparent text-[var(--color-accent)] text-[0.85rem] font-medium text-left [transition:background_0.15s_ease,color_0.15s_ease] hover:bg-white/[0.12]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                Clear Finished Tasks
              </button>
              <div className="h-px bg-white/[0.12] mx-1.5 my-1" />
              <button
                role="menuitem"
                onClick={() => { clearAll(); setKebabOpen(false); }}
                className="w-full flex items-center gap-[0.6rem] py-[0.55rem] px-3 rounded-lg bg-transparent text-[#ff9090] text-[0.85rem] font-medium text-left [transition:background_0.15s_ease,color_0.15s_ease] hover:bg-[rgba(255,80,80,0.18)] hover:text-[#ffb3b3]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                Clear All Tasks
              </button>
            </div>
          </div>
        </header>

        <hr className="border-0 border-t border-[var(--color-divider)] mb-3 [transition:border-color_0.4s_ease]" />

        <ul role="list" aria-label="Your tasks" className="flex flex-col gap-2 mb-3">
          {tasks.map((task) => {
            const removing = removingIds.has(task.id);
            return (
              <li
                key={task.id}
                data-task-id={task.id}
                onClick={() => toggleTask(task.id)}
                style={
                  removing
                    ? { transition: 'opacity 0.2s ease, transform 0.2s ease', opacity: 0, transform: 'translateX(12px)' }
                    : undefined
                }
                className={cn(
                  'group flex items-center gap-3 py-3 px-4 rounded-[10px] bg-[var(--color-task-bg)] border border-[var(--color-task-border)] cursor-pointer [transition:background_0.2s_ease,border-color_0.2s_ease,opacity_0.3s_ease] animate-[task-slide-in_0.25s_ease_forwards] hover:bg-[var(--color-task-hover)]',
                  task.completed && 'opacity-50'
                )}
              >
                <div
                  role="checkbox"
                  aria-checked={task.completed}
                  aria-label="Mark task complete"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggleTask(task.id);
                    }
                  }}
                  className={cn(
                    'w-5 h-5 min-w-[20px] rounded-full border-2 flex items-center justify-center [transition:border-color_0.2s_ease,background_0.2s_ease] shrink-0',
                    task.completed
                      ? 'bg-[var(--color-cta-bg)] border-[var(--color-cta-bg)]'
                      : 'border-[var(--color-muted)]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'text-[var(--color-cta-text)] text-[0.7rem] font-bold leading-none',
                      task.completed ? 'block' : 'hidden'
                    )}
                  >
                    ✓
                  </span>
                </div>

                <span
                  className={cn(
                    'flex-1 text-[0.9rem] font-medium [transition:color_0.3s_ease] break-words',
                    task.completed
                      ? 'line-through text-[var(--color-muted)]'
                      : 'text-[var(--color-accent)]'
                  )}
                >
                  {task.text}
                </span>

                <button
                  aria-label={`Delete task: ${task.text}`}
                  onClick={(e) => { e.stopPropagation(); removeTask(task.id); }}
                  className="w-[22px] h-[22px] rounded-full bg-white/10 text-[var(--color-muted)] text-[0.75rem] flex items-center justify-center opacity-0 [transition:opacity_0.2s_ease,background_0.2s_ease] shrink-0 group-hover:opacity-100 hover:bg-[rgba(255,80,80,0.3)] hover:text-[#ff8080]"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>

        {/* Inline add-task input (shown in place of the Add button) */}
        {showInput && (
          <div
            aria-hidden="false"
            className="bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-[10px] py-3 px-4 mb-3 flex flex-col gap-[0.6rem] animate-[task-slide-in_0.2s_ease_forwards] [transition:background_0.4s_ease]"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="What are you working on?"
              maxLength={120}
              aria-label="New task name"
              className="bg-transparent border-none outline-none text-[var(--color-accent)] text-[0.95rem] font-medium w-full p-0 caret-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={saveTask}
                className="bg-[var(--color-save-bg)] text-[var(--color-save-btn)] text-[0.85rem] font-bold py-[0.4rem] px-[1.2rem] rounded-[7px] [transition:opacity_0.2s_ease,transform_0.15s_ease] hover:opacity-[0.85] hover:scale-[1.02]"
              >
                Save
              </button>
              <button
                onClick={hideTaskInput}
                className="bg-transparent text-[var(--color-muted)] text-[0.85rem] font-medium py-[0.4rem] px-[0.8rem] rounded-[7px] border border-[var(--color-task-border)] [transition:background_0.2s_ease,color_0.2s_ease] hover:bg-white/10 hover:text-[var(--color-accent)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add-task button (hidden while the input panel is open) */}
        {!showInput && (
          <button
            onClick={showTaskInput}
            aria-label="Add a new task"
            className="w-full py-[0.85rem] px-4 rounded-[10px] border-2 border-dashed border-[var(--color-add-task-border)] bg-transparent text-[var(--color-muted)] text-[0.9rem] font-medium flex items-center justify-center gap-[0.4rem] [transition:background_0.2s_ease,color_0.2s_ease,border-color_0.2s_ease] hover:bg-[var(--color-task-bg)] hover:text-[var(--color-accent)] hover:border-white/55"
          >
            <span aria-hidden="true" className="text-base leading-none">＋</span>
            Add Task
          </button>
        )}
      </section>
    </main>
  );
}
