<script>
  import Icon from './Icon.svelte';
  import { FONTS, THEMES, LIMITS, readerSettings, updateReaderSettings, resetReaderSettings, currentDeviceClass } from '../lib/reader-settings.js';

  let { canFullscreen = false, fullscreenActive = false, onfullscreen, onclose } = $props();

  const s = $derived($readerSettings);

  function step(field, direction) {
    const { min, max, step: size } = LIMITS[field];
    const next = Math.round((s[field] + direction * size) * 100) / 100;
    updateReaderSettings({ [field]: Math.min(max, Math.max(min, next)) });
  }

  function lineHeightLabel(value) { return value.toFixed(2).replace(/0$/, ''); }
</script>

<section class="reader-settings" aria-label="Reader settings">
  <div class="reader-settings-head">
    <h2>Reading</h2>
    <span class="muted">Saved for this {currentDeviceClass()}</span>
    <button class="icon-button" type="button" aria-label="Close reader settings" onclick={onclose}><Icon name="close" size={20} /></button>
  </div>

  <div class="theme-row" role="group" aria-label="Theme">
    {#each Object.entries(THEMES) as [name, theme] (name)}
      <button type="button" class="theme-swatch" class:active={s.theme === name} aria-pressed={s.theme === name}
        style:--swatch-bg={name === 'custom' ? s.customBg : theme.bg} style:--swatch-text={name === 'custom' ? s.customText : theme.text}
        onclick={() => updateReaderSettings({ theme: name })}>
        <span class="swatch-sample">Аа</span><span class="swatch-label">{theme.label}</span>
      </button>
    {/each}
  </div>
  {#if s.theme === 'custom'}
    <div class="custom-colors">
      <label>Background <input type="color" value={s.customBg} oninput={(event) => updateReaderSettings({ customBg: event.currentTarget.value })} /></label>
      <label>Text <input type="color" value={s.customText} oninput={(event) => updateReaderSettings({ customText: event.currentTarget.value })} /></label>
    </div>
  {/if}

  <div class="setting-row">
    <label for="reader-font">Font</label>
    <select id="reader-font" value={s.font} onchange={(event) => updateReaderSettings({ font: event.currentTarget.value })}>
      {#each Object.entries(FONTS) as [name, font] (name)}<option value={name}>{font.label}</option>{/each}
    </select>
  </div>

  {#each [['fontSize', 'Text size', `${s.fontSize}px`], ['lineHeight', 'Line spacing', lineHeightLabel(s.lineHeight)], ['margin', 'Margins', `${s.margin}px`]] as [field, label, value] (field)}
    <div class="setting-row">
      <span>{label}</span>
      <div class="stepper">
        <button type="button" class="icon-button" aria-label={'Decrease ' + label.toLowerCase()} disabled={s[field] <= LIMITS[field].min} onclick={() => step(field, -1)}>−</button>
        <span class="stepper-value" aria-live="polite">{value}</span>
        <button type="button" class="icon-button" aria-label={'Increase ' + label.toLowerCase()} disabled={s[field] >= LIMITS[field].max} onclick={() => step(field, 1)}>+</button>
      </div>
    </div>
  {/each}

  <label class="setting-row toggle-row"><span>Justify text</span><input type="checkbox" checked={s.justify} onchange={(event) => updateReaderSettings({ justify: event.currentTarget.checked })} /></label>
  <label class="setting-row toggle-row"><span>Hyphenation</span><input type="checkbox" checked={s.hyphens} onchange={(event) => updateReaderSettings({ hyphens: event.currentTarget.checked })} /></label>
  {#if canFullscreen}
    <label class="setting-row toggle-row"><span>Full screen</span><input type="checkbox" checked={fullscreenActive} onchange={() => onfullscreen?.()} /></label>
  {/if}

  <button class="text-button reset-settings" type="button" onclick={resetReaderSettings}>Reset to defaults</button>
</section>
