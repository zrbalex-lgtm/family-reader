<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { fold } from '../lib/docx/viewer.js';

  // songs: [{ title, page }] with zero-based pages; page: current zero-based page.
  let { songs = [], page = 0, loading = false, onjump, onclose } = $props();
  let filter = $state('');
  let list = $state();
  let input = $state();

  // The current song is the last one starting on or before the current page.
  const current = $derived.by(() => {
    let found = -1;
    songs.forEach((song, index) => { if (song.page <= page) found = index; });
    return found;
  });
  const visible = $derived.by(() => {
    const needle = fold(filter.trim());
    const indexed = songs.map((song, index) => ({ ...song, index }));
    return needle ? indexed.filter((song) => fold(song.title).includes(needle)) : indexed;
  });

  onMount(async () => {
    await tick();
    list?.querySelector('.current')?.scrollIntoView({ block: 'center' });
    // Do not pop up the iPhone keyboard automatically; focus the filter on larger screens only.
    if (window.matchMedia?.('(pointer: fine)').matches) input?.focus();
  });
</script>

<section class="reader-contents song-list" aria-label="Song list">
  <div class="reader-contents-head">
    <h2>Songs{#if songs.length} <span class="tab-count">{songs.length}</span>{/if}</h2>
    <button class="icon-button" type="button" aria-label="Close song list" onclick={onclose}><Icon name="close" size={20} /></button>
  </div>
  <div class="song-filter">
    <Icon name="search" size={18} />
    <label class="visually-hidden" for="song-filter">Find a song</label>
    <input id="song-filter" type="search" bind:this={input} bind:value={filter} placeholder="Find a song" autocomplete="off" enterkeyhint="search" />
  </div>
  <div class="reader-contents-list" bind:this={list}>
    {#if loading}
      <p class="contents-empty">Building the song list…</p>
    {:else if !songs.length}
      <p class="contents-empty">No song titles were found in this document.</p>
    {:else if !visible.length}
      <p class="contents-empty">No songs match “{filter}”.</p>
    {:else}
      <ol class="toc-list">
        {#each visible as song (song.index)}
          <li>
            <button type="button" class="toc-entry" class:current={song.index === current} aria-current={song.index === current ? 'true' : undefined} onclick={() => onjump(song.page)}>
              <span class="toc-label">{song.title}</span><span class="toc-page">{song.page + 1}</span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</section>
