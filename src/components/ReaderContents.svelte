<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { percentAt } from '../lib/fb2/book.js';

  let { book, bookmarks = [], position, bookPages = 1, tab = $bindable('contents'), error = '', onjump, ondelete, onclose } = $props();
  let list = $state();

  function before(a, b) {
    return a.section < b.section || (a.section === b.section && a.paragraph <= b.paragraph);
  }

  // Index of the TOC entry containing a position (the last entry starting at or before it).
  function entryIndexFor(target) {
    let found = -1;
    book.toc.forEach((entry, index) => { if (target && before(entry.position, target)) found = index; });
    return found;
  }

  function pageLabel(target) {
    const percent = percentAt(book, target);
    return `p. ~${Math.min(bookPages, Math.floor((percent / 100) * bookPages) + 1)} · ${Math.floor(percent)}%`;
  }

  function chapterOf(target) {
    return book.toc[entryIndexFor(target)]?.label || '';
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
  }

  const current = $derived(entryIndexFor(position));

  // Bring the current chapter into view when the contents open.
  onMount(async () => {
    await tick();
    list?.querySelector('.current')?.scrollIntoView({ block: 'center' });
  });
</script>

<section class="reader-contents" aria-label="Contents and bookmarks">
  <div class="reader-contents-head">
    <div class="contents-tabs" role="group" aria-label="Show">
      <button type="button" class:active={tab === 'contents'} aria-pressed={tab === 'contents'} onclick={() => tab = 'contents'}>Contents</button>
      <button type="button" class:active={tab === 'bookmarks'} aria-pressed={tab === 'bookmarks'} onclick={() => tab = 'bookmarks'}>Bookmarks{#if bookmarks.length} <span class="tab-count">{bookmarks.length}</span>{/if}</button>
    </div>
    <button class="icon-button" type="button" aria-label="Close contents" onclick={onclose}><Icon name="close" size={20} /></button>
  </div>

  <div class="reader-contents-list" bind:this={list}>
    {#if tab === 'contents'}
      {#if book.toc.length}
        <ol class="toc-list">
          {#each book.toc as entry, index (index)}
            <li>
              <button type="button" class="toc-entry level-{Math.min(entry.level, 3)}" class:current={index === current} aria-current={index === current ? 'true' : undefined} onclick={() => onjump(entry.position)}>
                <span class="toc-label">{entry.label}</span><span class="toc-page">{pageLabel(entry.position)}</span>
              </button>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="contents-empty">This book has no chapter titles.</p>
      {/if}
    {:else}
      {#if error}<p class="contents-empty" role="alert">{error}</p>{/if}
      {#if bookmarks.length}
        <ul class="bookmark-list">
          {#each bookmarks as bookmark (bookmark.id)}
            <li class="bookmark-item">
              <button type="button" class="bookmark-open" onclick={() => onjump(bookmark.position)}>
                <span class="bookmark-meta">{chapterOf(bookmark.position)}{chapterOf(bookmark.position) ? ' · ' : ''}{pageLabel(bookmark.position)} · {formatDate(bookmark.created_at)}</span>
                {#if bookmark.excerpt}<span class="bookmark-excerpt">{bookmark.excerpt}</span>{/if}
                {#if bookmark.note}<span class="bookmark-note">{bookmark.note}</span>{/if}
              </button>
              <button type="button" class="icon-button" aria-label="Delete bookmark" title="Delete bookmark" onclick={() => ondelete(bookmark)}><Icon name="trash" size={18} /></button>
            </li>
          {/each}
        </ul>
      {:else if !error}
        <p class="contents-empty">No bookmarks yet. Open the toolbar and tap the bookmark icon to add one.</p>
      {/if}
    {/if}
  </div>
</section>
