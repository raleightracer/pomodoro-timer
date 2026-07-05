/* Pomodoro timer app */

'use strict';
/* State object */
const state = {
  /* Current mode */
  mode: 'pomodoro',

  timeRemaining: 1500,

  isRunning: false,

  intervalId: null,

  sessionCount: 1,

  pomodorosSinceBreak: 0,

  tasks: [],

  nextTaskId: 1,
};

/* Configuration */
const CONFIG = {
  durations: {
    pomodoro: 1500,
    short:    300,
    long:     900,
  },
  /* Theme class per mode */
  themeClasses: {
    pomodoro: 'theme-pomodoro',
    short:    'theme-short',
    long:     'theme-long',
  },
  /* Session labels per mode */
  sessionLabels: {
    pomodoro: 'Time to focus!',
    short:    'Take a short break.',
    long:     'Enjoy a long break!',
  },
};

/* DOM references */
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

/* Audio engine */
const audio = {
  /* Lazily created AudioContext */
  ctx: null,

  /* Plays the completion beep */
  playBeep() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const ctx = this.ctx;

      const playTone = (freq, startAt, duration) => {
        const oscillator = ctx.createOscillator();
        const gain       = ctx.createGain();

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.type      = 'sine';
        oscillator.frequency.setValueAtTime(freq, ctx.currentTime + startAt);

        gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startAt + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration - 0.02);

        oscillator.start(ctx.currentTime + startAt);
        oscillator.stop(ctx.currentTime + startAt + duration);
      };

      playTone(523.25, 0,    0.3);
      playTone(659.25, 0.35, 0.35);
      playTone(783.99, 0.75, 0.5);

    } catch (err) {
      console.warn('Web Audio API unavailable, using alert fallback:', err);
      alert('⏰ Timer complete! Great work!');
    }
  }
};

/* Timer engine */
const timer = {
  start() {
    if (state.isRunning) return;
    state.isRunning = true;

    dom.body.classList.add('timer-running');

    state.intervalId = setInterval(() => {
      state.timeRemaining -= 1;

      ui.renderTime();

      if (state.timeRemaining <= 0) {
        timer.complete();
      }
    }, 1000);

    ui.renderButton();
  },

  pause() {
    if (!state.isRunning) return;
    state.isRunning = false;

    clearInterval(state.intervalId);
    state.intervalId = null;

    dom.body.classList.remove('timer-running');
    ui.renderButton();
  },

  toggle() {
    if (state.isRunning) {
      timer.pause();
    } else {
      timer.start();
    }
  },

  complete() {
    timer.pause();

    audio.playBeep();

    if (state.mode === 'pomodoro') {
      state.pomodorosSinceBreak += 1;
      state.sessionCount       += 1;

      if (state.pomodorosSinceBreak >= 4) {
        state.pomodorosSinceBreak = 0;
        timer.switchMode('long');
      } else {
        timer.switchMode('short');
      }
    } else {
      timer.switchMode('pomodoro');
    }

    document.title = '✅ Timer done! — Pomodoro';
    setTimeout(() => {
      document.title = 'Pomodoro Timer';
    }, 3000);
  },

  switchMode(newMode) {
    timer.pause();

    state.mode          = newMode;
    state.timeRemaining = CONFIG.durations[newMode];

    ui.renderAll();
  },

  reset() {
    timer.pause();
    state.timeRemaining = CONFIG.durations[state.mode];
    ui.renderTime();
    ui.renderButton();
  },
};

/* Theme manager */
const theme = {
  apply() {
    dom.body.classList.remove('theme-pomodoro', 'theme-short', 'theme-long');

    const themeClass = CONFIG.themeClasses[state.mode];
    dom.body.classList.add(themeClass);
  }
};

/* UI renderer */
const ui = {
  formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return {
      minutes: String(m).padStart(2, '0'),
      seconds: String(s).padStart(2, '0'),
    };
  },

  /* Updates the timer display */
  renderTime() {
    const { minutes, seconds } = ui.formatTime(state.timeRemaining);
    dom.timerMinutes.textContent = minutes;
    dom.timerSeconds.textContent = seconds;

    document.title = `${minutes}:${seconds} — Pomodoro`;
  },

  /* Updates the start/pause button */
  renderButton() {
    dom.startPauseBtn.textContent = state.isRunning ? 'PAUSE' : 'START';
    dom.startPauseBtn.setAttribute('aria-label', state.isRunning ? 'Pause timer' : 'Start timer');
  },

  /* Updates the active mode tab */
  renderMode() {
    dom.modeBtns.forEach(btn => {
      const isActive = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    theme.apply();
  },

  /* Updates the session label */
  renderSession() {
    dom.sessionCount.textContent = state.sessionCount;
    dom.sessionText.textContent  = CONFIG.sessionLabels[state.mode];
  },

  /* Re-renders the whole UI */
  renderAll() {
    ui.renderTime();
    ui.renderButton();
    ui.renderMode();
    ui.renderSession();
  },
};

/* Task manager */
const tasks = {
  add(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const task = {
      id:        state.nextTaskId++,
      text:      trimmed,
      completed: false,
    };

    state.tasks.push(task);
    tasks.renderTask(task);
  },

  toggle(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;

    const taskEl = dom.taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (taskEl) {
      taskEl.classList.toggle('completed', task.completed);
      const checkbox = taskEl.querySelector('.task-checkbox');
      checkbox.setAttribute('aria-checked', String(task.completed));
    }
  },

  remove(taskId) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);

    const taskEl = dom.taskList.querySelector(`[data-task-id="${taskId}"]`);
    if (taskEl) {
      taskEl.style.transition  = 'opacity 0.2s ease, transform 0.2s ease';
      taskEl.style.opacity     = '0';
      taskEl.style.transform   = 'translateX(12px)';
      setTimeout(() => taskEl.remove(), 200);
    }
  },

  clearCompleted() {
    const completedIds = state.tasks
      .filter(t => t.completed)
      .map(t => t.id);
    completedIds.forEach(id => tasks.remove(id));
  },

  markAllCompleted() {
    state.tasks.forEach(task => {
      if (!task.completed) {
        tasks.toggle(task.id);
      }
    });
  },

  clearAll() {
    const allIds = state.tasks.map(t => t.id);
    allIds.forEach(id => tasks.remove(id));
  },

  renderTask(task) {
    const li = document.createElement('li');
    li.className   = `task-item${task.completed ? ' completed' : ''}`;
    li.dataset.taskId = task.id;

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

    const checkbox = li.querySelector('.task-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.toggle(task.id);
    });

    checkbox.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        tasks.toggle(task.id);
      }
    });

    const deleteBtn = li.querySelector('.task-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tasks.remove(task.id);
    });

    dom.taskList.appendChild(li);
  },
};

/* Add task input panel */
const taskInput = {
  show() {
    dom.addTaskInputWrap.classList.add('visible');
    dom.addTaskInputWrap.setAttribute('aria-hidden', 'false');
    dom.addTaskBtn.style.display = 'none';
    dom.addTaskInput.focus();
  },

  hide() {
    dom.addTaskInputWrap.classList.remove('visible');
    dom.addTaskInputWrap.setAttribute('aria-hidden', 'true');
    dom.addTaskInput.value  = '';
    dom.addTaskBtn.style.display = '';
  },

  save() {
    const text = dom.addTaskInput.value.trim();
    if (text) {
      tasks.add(text);
    }
    taskInput.hide();
  },
};

/* Utility functions */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/* Event listeners */

dom.startPauseBtn.addEventListener('click', () => {
  timer.toggle();
});

dom.modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const newMode = btn.dataset.mode;
    if (newMode !== state.mode) {
      timer.switchMode(newMode);
    } else {
      timer.reset();
    }
  });
});

dom.addTaskBtn.addEventListener('click', () => {
  taskInput.show();
});

dom.btnSaveTask.addEventListener('click', () => {
  taskInput.save();
});

dom.btnCancelTask.addEventListener('click', () => {
  taskInput.hide();
});

dom.addTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    taskInput.save();
  }
  if (e.key === 'Escape') {
    taskInput.hide();
  }
});

dom.skipBtn.addEventListener('click', () => {
  let nextMode;
  if (state.mode === 'pomodoro') {
    const wouldBe = state.pomodorosSinceBreak + 1;
    nextMode = wouldBe >= 4 ? 'long' : 'short';
  } else {
    nextMode = 'pomodoro';
  }

  timer.switchMode(nextMode);
});

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

document.addEventListener('click', () => kebab.close());

dom.kebabDropdown.addEventListener('click', (e) => e.stopPropagation());

dom.menuMarkAll.addEventListener('click', () => {
  tasks.markAllCompleted();
  kebab.close();
});

dom.menuClearFinished.addEventListener('click', () => {
  tasks.clearCompleted();
  kebab.close();
});

dom.menuClearAll.addEventListener('click', () => {
  tasks.clearAll();
  kebab.close();
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;

  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    timer.toggle();
  }
});

/* Initialization */
(function init() {
  ui.renderAll();

  tasks.add('Complete the design mockup');
  tasks.add('Review pull request #47');

  console.log(
    '%c🍅 Pomodoro Timer initialized!',
    'color: #e74c3c; font-weight: bold; font-size: 14px;'
  );
  console.log('Tip: Press [Space] to start/pause the timer from anywhere on the page.');
})();
