// settings-panel.js
// Renders the shader's own options (parsed by shader-options-parser.js)
// as a real settings UI grouped the way the pack author organized them
// (shaders.properties `screen`/`screen.X` groups), falling back to one
// flat "Shader Settings" group for packs with no shaders.properties.

function titleCase(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export class SettingsPanel {
  constructor(container, { onChange }) {
    this.container = container;
    this.onChange = onChange;
    this.overrides = {};
  }

  render(schema) {
    this.container.innerHTML = '';
    this.overrides = {};
    this.schema = schema;

    if (!schema || schema.options.length === 0) {
      this.container.innerHTML = '<p class="settings-empty">No user-configurable options found in this pack.</p>';
      return;
    }

    const byId = new Map(schema.options.map((o) => [o.id, o]));
    const grouped = schema.screens[''] && schema.screens[''].length
      ? schema.screens['']
      : schema.options.map((o) => o.id);

    const rendered = new Set();
    const renderGroup = (title, ids) => {
      const group = document.createElement('fieldset');
      group.className = 'settings-group';
      const legend = document.createElement('legend');
      legend.textContent = title;
      group.appendChild(legend);
      let any = false;
      for (const id of ids) {
        if (schema.screens[id]) { // nested screen, e.g. [SHADOW]
          continue;
        }
        const opt = byId.get(id);
        if (!opt || rendered.has(id)) continue;
        rendered.add(id);
        group.appendChild(this._renderOption(opt));
        any = true;
      }
      if (any) this.container.appendChild(group);
    };

    renderGroup('Shader Settings', grouped);
    for (const [screenName, ids] of Object.entries(schema.screens)) {
      if (screenName === '') continue;
      renderGroup(titleCase(screenName), ids);
    }

    // Any option not referenced by any screen still needs to be shown.
    const leftover = schema.options.map((o) => o.id).filter((id) => !rendered.has(id));
    if (leftover.length) renderGroup('Other Options', leftover);
  }

  _renderOption(opt) {
    const row = document.createElement('label');
    row.className = 'settings-row';
    row.title = opt.comment || '';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'settings-label';
    labelSpan.textContent = titleCase(opt.id);
    row.appendChild(labelSpan);

    let input;
    if (opt.kind === 'bool') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = opt.default === 'true';
      input.addEventListener('change', () => this._change(opt, String(input.checked)));
    } else if (opt.choices.length > 1) {
      input = document.createElement('select');
      for (const choice of opt.choices) {
        const o = document.createElement('option');
        o.value = choice;
        o.textContent = choice;
        if (choice === opt.default) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => this._change(opt, input.value));
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = opt.default;
      input.addEventListener('change', () => this._change(opt, input.value));
    }
    input.className = 'settings-input';
    row.appendChild(input);

    if (opt.requiresRecompile) {
      const badge = document.createElement('span');
      badge.className = 'settings-recompile-badge';
      badge.textContent = 'recompiles shader';
      row.appendChild(badge);
    }

    return row;
  }

  _change(opt, value) {
    this.overrides[opt.id] = value;
    this.onChange({ id: opt.id, value, requiresRecompile: !!opt.requiresRecompile });
  }

  getOverrides() {
    return this.overrides;
  }
}
