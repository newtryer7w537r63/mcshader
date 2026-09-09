// console-log.js
// A minimal on-page log panel. Real shader translation/compilation can
// fail in ways the user needs to see (which program, why) - this is a
// dev-tool console, not a toast notification, so entries persist and
// scroll rather than disappearing after a few seconds.

export class ConsoleLog {
  constructor(container) {
    this.container = container;
  }

  log(level, message) {
    const line = document.createElement('div');
    line.className = `console-line console-${level}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    line.innerHTML = `<span class="console-time">${time}</span><span class="console-level">${level}</span><span class="console-msg"></span>`;
    line.querySelector('.console-msg').textContent = message;
    this.container.appendChild(line);
    this.container.scrollTop = this.container.scrollHeight;
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[mc-shader-preview] ${message}`);
  }

  clear() {
    this.container.innerHTML = '';
  }
}
