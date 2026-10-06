<script>
  import { onMount } from 'svelte';
  import BookCover from './BookCover.svelte';
  import Icon from './Icon.svelte';

  // `extra` is an optional snippet rendered between the book info and the actions,
  // reserved for a later rating control.
  let { book, onlibrary, onclose, onrestart, extra } = $props();
  let primary = $state();

  onMount(() => primary?.focus());
</script>

<section class="end-of-book" aria-labelledby="end-title">
  <div class="end-card">
    <p class="end-eyebrow" id="end-title">The End</p>
    <div class="end-cover"><BookCover {book} /></div>
    <h2 class="end-book-title">{book.title}</h2>
    {#if book.author}<p class="end-author">{book.author}</p>{/if}
    {#if extra}<div class="end-extra">{@render extra()}</div>{/if}
    <div class="end-actions">
      <button class="button primary" type="button" bind:this={primary} onclick={onlibrary}><Icon name="back" size={18} /> Back to library</button>
      <button class="button secondary" type="button" onclick={onclose}>Close</button>
      <button class="button secondary" type="button" onclick={onrestart}><Icon name="refresh" size={18} /> Read again</button>
    </div>
  </div>
</section>
