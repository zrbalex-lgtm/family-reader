<script>
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import BookCover from './BookCover.svelte';
  import Icon from './Icon.svelte';

  // Behaves like an extra page after the last one: swipe right or tap the left third to go back.
  // `extra` is an optional snippet rendered between the book info and the actions,
  // reserved for a later rating control.
  let { book, onclose, onrestart, onback, extra } = $props();
  let element = $state();

  const SWIPE_DISTANCE = 40;
  const TAP_SLOP = 12;
  const motion = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const slide = { x: window.innerWidth, opacity: 1, duration: motion ? 260 : 0 };
  let start = null;

  // Listeners are attached directly, like the reader page, so the section stays a plain landmark.
  onMount(() => {
    element.focus();
    const cancel = () => { start = null; };
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', cancel);
    return () => {
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', cancel);
    };
  });

  function pointerDown(event) {
    if (!event.isPrimary || event.button > 0) return;
    start = { x: event.clientX, y: event.clientY };
  }

  function pointerUp(event) {
    if (!start || !event.isPrimary) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    const swipeBack = dx > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2;
    const tapLeft = Math.hypot(dx, dy) <= TAP_SLOP && event.clientX < element.getBoundingClientRect().width / 3;
    if (swipeBack || tapLeft) onback();
  }
</script>

<section class="end-of-book" aria-labelledby="end-title" tabindex="-1" bind:this={element}
  transition:fly={slide}>
  <div class="end-card">
    <p class="end-eyebrow" id="end-title">The End</p>
    <div class="end-cover"><BookCover {book} /></div>
    <h2 class="end-book-title">{book.title}</h2>
    {#if book.author}<p class="end-author">{book.author}</p>{/if}
    {#if extra}<div class="end-extra">{@render extra()}</div>{/if}
    <div class="end-actions">
      <button class="button primary" type="button" onclick={onclose}><Icon name="close" size={18} /> Close</button>
      <button class="button secondary" type="button" onclick={onrestart}><Icon name="refresh" size={18} /> Read again</button>
    </div>
    <p class="end-hint">Swipe right or tap the left side to return to the last page.</p>
  </div>
</section>
