/**
 * ================================================================
 * POMODORO TIMER — app.js
 * 
 * Architecture overview:
 *  1. STATE OBJECT    — single source of truth for all dynamic data
 *  2. TIMER ENGINE    — setInterval-based countdown with start/pause
 *  3. THEME MANAGER   — applies CSS classes to <body> for theming
 *  4. UI RENDERER     — updates DOM based on current state
 *  5. TASK MANAGER    — CRUD operations for the task list
 *  6. AUDIO ENGINE    — generates a beep using the Web Audio API
 *  7. EVENT BINDING   — wires up all user interactions
 * ================================================================
 */

'use strict';

/* ================================================================
   1. STATE OBJECT
   All mutable application state lives here. Mutating this object
   and then calling render functions keeps UI in sync with data.
   ================================================================ */
const state = {
  /** Current mode: 'pomodoro' | 'short' | 'long' */
  mode: 'pomodoro',

  /**
   * Time remaining in seconds.
   * Pomodoro = 25:00 = 1500s | Short = 5:00 = 300s | Long = 15:00 = 900s
   */
  timeRemaining: 1500,

  /** Whether the countdown is actively ticking */
  isRunning: false,

  /** Reference to the setInterval timer (so we can clear it) */
  intervalId: null,

  /** How many Pomodoro sessions have been completed */
  sessionCount: 1,

  /** How many Pomodoros since last long break (auto-advance logic) */
  pomodorosSinceBreak: 0,

  /** Array of task objects: { id, text, completed } */
  tasks: [],

  /** Auto-incrementing task ID counter */
  nextTaskId: 1,
};

/* ================================================================
   2. CONFIGURATION
   All magic numbers in one place for easy customization.
   ================================================================ */
const CONFIG = {
  durations: {
    pomodoro: 1500,  // 25 minutes in seconds
    short:    300,   //  5 minutes in seconds
    long:     900,   // 15 minutes in seconds
  },
  /** Theme class applied to <body> per mode */
  themeClasses: {
    pomodoro: 'theme-pomodoro',
    short:    'theme-short',
    long:     'theme-long',
  },
  /** Human-readable session labels per mode */
  sessionLabels: {
    pomodoro: 'Time to focus!',
    short:    'Take a short break.',
    long:     'Enjoy a long break!',
  },
};

/* ================================================================
   3. DOM REFERENCES
   Cache all DOM queries upfront to avoid repeated lookups.
   ================================================================ */
const dom = {
  body:              document.body,
  timerMinutes:      document.getElementById('timer-minutes'),
  timerSeconds:      document.getElementById('timer-seconds'),
  startPauseBtn:     document.getElementById('start-pause-btn'),
  sessionCount:      document.getElementById('session-count'),
  sessionText:       document.getElementById('session-text'),
  modeBtns:          document.querySelectorAll('.mode-btn'),
  taskList:          document.getElementById('task-list'),
  addTaskBtn:        document.getElementById('add-task-btn'),
  addTaskInputWrap:  document.getElementById('add-task-input-wrapper'),
  addTaskInput:      document.getElementById('add-task-input'),
  btnSaveTask:       document.getElementById('btn-save-task'),
  btnCancelTask:     document.getElementById('btn-cancel-task'),
  kebabBtn:          document.getElementById('kebab-btn'),
  kebabDropdown:     document.getElementById('kebab-dropdown'),
  menuMarkAll:       document.getElementById('menu-mark-all'),
  menuClearFinished: document.getElementById('menu-clear-finished'),
  menuClearAll:      document.getElementById('menu-clear-all'),
  skipBtn:           document.getElementById('skip-btn'),
};

/* ================================================================
   4. AUDIO ENGINE
   Uses the Web Audio API to synthesize a soft "ding" beep
   without needing any external audio files.
   ================================================================ */
const audio = {
  /** Lazily-created AudioContext (must be created after user gesture) */
  ctx: null,

  /**
   * Plays a pleasant two-tone beep sequence using oscillators.
   * Web Audio API lets us generate sound programmatically:
   * - OscillatorNode generates the tone
   * - GainNode controls volume (and prevents clicks at start/end)
   */
  playBeep() {
    try {
      // Create or reuse AudioContext
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const ctx = this.ctx;

      /**
       * Helper: plays a single tone at a given frequency for a duration.
       * @param {number} freq     - Frequency in Hz
       * @param {number} startAt  - Start time offset in seconds
       * @param {number} duration - Duration in seconds
       */
      const playTone = (freq, startAt, duration) => {
        const oscillator = ctx.createOscillator();
        const gain       = ctx.createGain();

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.type      = 'sine';
        oscillator.frequency.setValueAtTime(freq, ctx.currentTime + startAt);

        // Fade in quickly to avoid click
        gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startAt + 0.02);
        // Fade out at end of tone
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration - 0.02);

        oscillator.start(ctx.currentTime + startAt);
        oscillator.stop(ctx.currentTime + startAt + duration);
      };

      // Play a pleasant two-note sequence: C5 then E5
      playTone(523.25, 0,    0.3);  // C5
      playTone(659.25, 0.35, 0.35); // E5
      playTone(783.99, 0.75, 0.5);  // G5 (completing the chord)

    } catch (err) {
      // Fallback: browser alert if Web Audio API is unavailable
      console.warn('Web Audio API unavailable, using alert fallback:', err);
      alert('⏰ Timer complete! Great work!');
    }
  }
};

/* ================================================================
   5. TIMER ENGINE
   ================================================================ */
const timer = {
  /**
   * Starts the countdown interval.
   * Uses setInterval to tick every 1000ms (1 second).
   */
  start() {
    if (state.isRunning) return; // Guard: don't start twice
    state.isRunning = true;

    // Add class to body so the colon can pulse (see CSS animation)
    dom.body.classList.add('timer-running');

    state.intervalId = setInterval(() => {
      // Decrement time by 1 second
      state.timeRemaining -= 1;

      // Render the updated time to the display
      ui.renderTime();

      // Check if we've hit zero
      if (state.timeRemaining <= 0) {
        timer.complete();
      }
    }, 1000);

    ui.renderButton();
  },

  /**
   * Pauses the countdown by clearing the interval.
   * State is preserved so it can be resumed from where it left off.
   */
  pause() {
    if (!state.isRunning) return; // Guard
    state.isRunning = false;

    clearInterval(state.intervalId);
    state.intervalId = null;

    dom.body.classList.remove('timer-running');
    ui.renderButton();
  },

  /**
   * Toggles between start and pause.
   * Called by the main CTA button click handler.
   */
  toggle() {
    if (state.isRunning) {
      timer.pause();
    } else {
      timer.start();
    }
  },

  /**
   * Handles the moment the countdown reaches zero.
   * Plays a beep, increments session count, and auto-advances mode.
   */
  complete() {
    // Stop the interval
    timer.pause();

    // Play the completion sound
    audio.playBeep();

    // Handle session progression logic
    if (state.mode === 'pomodoro') {
      state.pomodorosSinceBreak += 1;
      state.sessionCount       += 1;

      // Every 4 pomodoros, trigger a long break
      if (state.pomodorosSinceBreak >= 4) {
        state.pomodorosSinceBreak = 0;
        timer.switchMode('long');
      } else {
        timer.switchMode('short');
      }
    } else {
      // After any break, return to Pomodoro
      timer.switchMode('pomodoro');
    }

    // Brief visual notification using the page title
    document.title = '✅ Timer done! — Pomodoro';
    setTimeout(() => {
      document.title = 'Pomodoro Timer';
    }, 3000);
  },

  /**
   * Switches to a different timer mode.
   * Resets the timer, updates state, re-renders all mode-affected UI.
   * @param {'pomodoro'|'short'|'long'} newMode
   */
  switchMode(newMode) {
    // Stop any running timer before switching
    timer.pause();

    // Update state
    state.mode          = newMode;
    state.timeRemaining = CONFIG.durations[newMode];

    // Update the DOM
    ui.renderAll();
  },

  /**
   * Resets the current timer to its full duration without switching modes.
   */
  reset() {
    timer.pause();
    state.timeRemaining = CONFIG.durations[state.mode];
    ui.renderTime();
    ui.renderButton();
  },
};

/* ================================================================
   6. THEME MANAGER
   ================================================================ */
const theme = {
  /**
   * Applies the correct theme class to <body> based on current mode.
   * CSS transitions on body handle the smooth color shift.
   */
  apply() {
    // Remove all possible theme classes first
    dom.body.classList.remove('theme-pomodoro', 'theme-short', 'theme-long');

    // Add the correct one for the current mode
    const themeClass = CONFIG.themeClasses[state.mode];
    dom.body.classList.add(themeClass);
  }
};

/* ================================================================
   7. UI RENDERER
   Functions that read from `state` and update the DOM accordingly.
   ================================================================ */
const ui = {
  /**
   * Formats a total number of seconds into "MM:SS" string parts.
   * Returns an object with { minutes, seconds } as zero-padded strings.
   * @param {number} totalSeconds
   * @returns {{ minutes: string, seconds: string }}
   */
  formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return {
      minutes: String(m).padStart(2, '0'),
      seconds: String(s).padStart(2, '0'),
    };
  },

  /** Updates the MM:SS display */
  renderTime() {
    const { minutes, seconds } = ui.formatTime(state.timeRemaining);
    dom.timerMinutes.textContent = minutes;
    dom.timerSeconds.textContent = seconds;

    // Also update the browser tab title so users see time even when tab is hidden
    document.title = `${minutes}:${seconds} — Pomodoro`;
  },

  /** Updates the START/PAUSE button text based on running state */
  renderButton() {
    dom.startPauseBtn.textContent = state.isRunning ? 'PAUSE' : 'START';
    dom.startPauseBtn.setAttribute('aria-label', state.isRunning ? 'Pause timer' : 'Start timer');
  },

  /** Updates active mode tab and applies theme */
  renderMode() {
    // Update active class on mode buttons
    dom.modeBtns.forEach(btn => {
      const isActive = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    // Apply correct theme to body
    theme.apply();
  },

  /** Updates the session counter and label text */
  renderSession() {
    dom.sessionCount.textContent = state.sessionCount;
    dom.sessionText.textContent  = CONFIG.sessionLabels[state.mode];
  },

  /**
   * Full re-render of everything derived from state.
   * Call this after mode switches or other wholesale state changes.
   */
  renderAll() {
    ui.renderTime();
    ui.renderButton();
    ui.renderMode();
    ui.renderSession();
  },
};

/* ================================================================
   8. TASK MANAGER
   ================================================================ */
const tasks = {
  /**
   * Creates a new task object and adds it to state.
   * @param {string} text - The task description
   */
  add(text) {
    const trimmed = text.trim();
    if (!trimmed) return; // Reject empty tasks

    const task = {
      id:        state.nextTaskId++,
      text:      trimmed,
      completed: false,
    };

    state.tasks.push(task);
    tasks.renderTask(task); // Render just the new task (efficient)
  },

  /**
   * Toggles the completed state of a task.
   * @param {number} taskId
   */
  toggle(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;

    // Update the DOM element for this specific task
    const taskEl = dom.taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (taskEl) {
      taskEl.classList.toggle('completed', task.completed);
      const checkbox = taskEl.querySelector('.task-checkbox');
      checkbox.setAttribute('aria-checked', String(task.completed));
    }
  },

  /**
   * Removes a task from state and DOM.
   * @param {number} taskId
   */
  remove(taskId) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);

    const taskEl = dom.taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (taskEl) {
      // Animate out before removing
      taskEl.style.transition  = 'opacity 0.2s ease, transform 0.2s ease';
      taskEl.style.opacity     = '0';
      taskEl.style.transform   = 'translateX(12px)';
      setTimeout(() => taskEl.remove(), 200);
    }
  },

  /**
   * Removes all completed tasks from state and DOM.
   */
  clearCompleted() {
    const completedIds = state.tasks
      .filter(t => t.completed)
      .map(t => t.id);
    completedIds.forEach(id => tasks.remove(id));
  },

  /**
   * Marks every task as completed.
   */
  markAllCompleted() {
    state.tasks.forEach(task => {
      if (!task.completed) {
        tasks.toggle(task.id);
      }
    });
  },

  /**
   * Removes every task regardless of completion state.
   */
  clearAll() {
    // Copy IDs first since remove() mutates state.tasks
    const allIds = state.tasks.map(t => t.id);
    allIds.forEach(id => tasks.remove(id));
  },

  /**
   * Creates and appends a single task DOM element.
   * @param {{ id: number, text: string, completed: boolean }} task
   */
  renderTask(task) {
    const li = document.createElement('li');
    li.className   = `task-item${task.completed ? ' completed' : ''}`;
    li.dataset.taskId = task.id;

    /**
     * Build the task item HTML structure:
     * [checkbox circle] [text label] [delete ×]
     * 
     * Using a role="checkbox" for the toggle area makes it
     * semantically correct for screen readers.
     */
    li.innerHTML = `
      <div class="task-checkbox"
           role="checkbox"
           aria-checked="${task.completed}"
           aria-label="Mark task complete"
           tabindex="0">
        <span class="checkmark" aria-hidden="true">✓</span>
      </div>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <button class="task-delete" aria-label="Delete task: ${escapeHtml(task.text)}">×</button>
    `;

    // Checkbox toggle
    const checkbox = li.querySelector('.task-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't bubble
      tasks.toggle(task.id);
    });

    // Keyboard support for checkbox (Space/Enter to toggle)
    checkbox.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        tasks.toggle(task.id);
      }
    });

    // Delete button
    const deleteBtn = li.querySelector('.task-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.remove(task.id);
    });

    dom.taskList.appendChild(li);
  },
};

/* ================================================================
   9. ADD TASK INPUT PANEL
   Controls show/hide of the inline task entry field.
   ================================================================ */
const taskInput = {
  /** Show the inline input panel and focus the input field */
  show() {
    dom.addTaskInputWrap.classList.add('visible');
    dom.addTaskInputWrap.setAttribute('aria-hidden', 'false');
    dom.addTaskBtn.style.display = 'none'; // Hide the "Add Task" button
    dom.addTaskInput.focus();
  },

  /** Hide the panel and clear the input */
  hide() {
    dom.addTaskInputWrap.classList.remove('visible');
    dom.addTaskInputWrap.setAttribute('aria-hidden', 'true');
    dom.addTaskInput.value  = '';
    dom.addTaskBtn.style.display = ''; // Restore the "Add Task" button
  },

  /** Save the current input value as a new task */
  save() {
    const text = dom.addTaskInput.value.trim();
    if (text) {
      tasks.add(text);
    }
    taskInput.hide();
  },
};

/* ================================================================
   10. UTILITY FUNCTIONS
   ================================================================ */

/**
 * Escapes HTML special characters to prevent XSS when inserting
 * user-provided task text as innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/* ================================================================
   11. EVENT LISTENERS
   Wire up all interactive elements.
   ================================================================ */

/** START / PAUSE button */
dom.startPauseBtn.addEventListener('click', () => {
  timer.toggle();
});

/** MODE NAVIGATION TABS */
dom.modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const newMode = btn.dataset.mode;
    if (newMode !== state.mode) {
      timer.switchMode(newMode);
    } else {
      // Clicking the active mode resets the timer
      timer.reset();
    }
  });
});

/** ADD TASK button (shows inline input) */
dom.addTaskBtn.addEventListener('click', () => {
  taskInput.show();
});

/** SAVE TASK button */
dom.btnSaveTask.addEventListener('click', () => {
  taskInput.save();
});

/** CANCEL button (hides input without saving) */
dom.btnCancelTask.addEventListener('click', () => {
  taskInput.hide();
});

/**
 * Task input — keyboard shortcuts:
 *   Enter → save the task
 *   Escape → cancel and close
 */
dom.addTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    taskInput.save();
  }
  if (e.key === 'Escape') {
    taskInput.hide();
  }
});

/** SKIP BUTTON — immediately advances to the next logical phase */
dom.skipBtn.addEventListener('click', () => {
  // Determine the next mode based on current mode
  let nextMode;
  if (state.mode === 'pomodoro') {
    // Same logic as timer.complete(): every 4th pomodoro → long break
    const wouldBe = state.pomodorosSinceBreak + 1;
    nextMode = wouldBe >= 4 ? 'long' : 'short';
  } else {
    // Any break → back to Pomodoro
    nextMode = 'pomodoro';
  }

  timer.switchMode(nextMode);
});

/** KEBAB MENU — toggle open/close */
const kebab = {
  open() {
    dom.kebabDropdown.classList.add('open');
    dom.kebabDropdown.setAttribute('aria-hidden', 'false');
    dom.kebabBtn.setAttribute('aria-expanded', 'true');
  },
  close() {
    dom.kebabDropdown.classList.remove('open');
    dom.kebabDropdown.setAttribute('aria-hidden', 'true');
    dom.kebabBtn.setAttribute('aria-expanded', 'false');
  },
  toggle() {
    dom.kebabDropdown.classList.contains('open') ? kebab.close() : kebab.open();
  },
};

dom.kebabBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  kebab.toggle();
});

/** Close dropdown when clicking anywhere outside */
document.addEventListener('click', () => kebab.close());

/** Prevent clicks inside the dropdown from closing it */
dom.kebabDropdown.addEventListener('click', (e) => e.stopPropagation());

/** MARK ALL AS FINISHED */
dom.menuMarkAll.addEventListener('click', () => {
  tasks.markAllCompleted();
  kebab.close();
});

/** CLEAR FINISHED TASKS */
dom.menuClearFinished.addEventListener('click', () => {
  tasks.clearCompleted();
  kebab.close();
});

/** CLEAR ALL TASKS */
dom.menuClearAll.addEventListener('click', () => {
  tasks.clearAll();
  kebab.close();
});

/**
 * KEYBOARD SHORTCUT — Space bar starts/pauses when not typing in an input.
 * This is a common UX pattern for timer apps.
 */
document.addEventListener('keydown', (e) => {
  // Only fire if the focused element is not an input/button
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;

  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault(); // Prevent page scroll
    timer.toggle();
  }
});

/* ================================================================
   12. INITIALIZATION
   Set up the initial state and render the first frame.
   ================================================================ */
(function init() {
  // Render the complete UI from initial state
  ui.renderAll();

  // Add a couple of example tasks to help orient new users
  tasks.add('Complete the design mockup');
  tasks.add('Review pull request #47');

  console.log(
    '%c🍅 Pomodoro Timer initialized!',
    'color: #e74c3c; font-weight: bold; font-size: 14px;'
  );
  console.log('Tip: Press [Space] to start/pause the timer from anywhere on the page.');
})();
