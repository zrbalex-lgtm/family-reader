<script>
  import { onMount } from 'svelte';
  import { supabase } from '../lib/supabase.js';
  import Icon from './Icon.svelte';
  // progress: reading percent 0–100, or null when the book has not been opened.
  let { book, progress = null } = $props();
  let frame = $state();
  let url = $state('');
  let failed = $state(false);
  const colors = ['#293f43', '#43394f', '#4b3930', '#30433a', '#374254', '#4b3c46'];
  const color = $derived(colors[(parseInt(book.id.slice(0, 4), 16) || 0) % colors.length]);

  onMount(() => {
    let alive = true;
    let objectUrl = '';
    let observer;
    async function load() {
      if (!book.cover_path) return;
      try {
        const { data, error } = await supabase.storage.from('library').download(book.cover_path);
        if (error) throw error;
        if (!alive) return;
        objectUrl = URL.createObjectURL(data);
        url = objectUrl;
      } catch { if (alive) failed = true; }
    }
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      }, { rootMargin: '250px' });
      observer.observe(frame);
    } else void load();
    return () => { alive = false; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>

<span bind:this={frame} class="book-cover" style:--cover-tint={color} aria-hidden="true">
  {#if url && !failed}
    <img src={url} alt="" loading="lazy" decoding="async" onerror={() => failed = true} />
  {:else}
    <span class="text-cover">
      <Icon name={book.kind === 'docx' ? 'document' : 'book'} size={26} />
      <span class="text-cover-title">{book.title}</span>
      <span class="text-cover-author">{book.author || (book.kind === 'docx' ? 'DOCUMENT' : 'FAMILY LIBRARY')}</span>
    </span>
  {/if}
  <span class="format-tag">{book.kind.toUpperCase()}</span>
  {#if progress !== null && progress > 0}<span class="cover-progress"><span style:width={Math.min(100, progress) + '%'}></span></span>{/if}
</span>
