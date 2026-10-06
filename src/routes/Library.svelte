<script>
  import Icon from '../components/Icon.svelte';
  let kind = $state('fb2');
</script>

<main class="content library-content" id="main" tabindex="-1">
  <div class="page-heading">
    <span class="eyebrow">YOUR SHARED SHELVES</span>
    <h1>Library</h1>
    <p class="muted">A place for everyone’s next chapter.</p>
  </div>
  <div class="library-tabs" aria-label="Library type">
    <button class:active={kind === 'fb2'} aria-pressed={kind === 'fb2'} onclick={() => kind = 'fb2'}><Icon name="book" size={19} /> Books</button>
    <button class:active={kind === 'docx'} aria-pressed={kind === 'docx'} onclick={() => kind = 'docx'}><Icon name="document" size={19} /> Documents</button>
  </div>
  <section class="empty-library" aria-live="polite">
    <div class="empty-icon"><Icon name={kind === 'fb2' ? 'book' : 'document'} size={34} /></div>
    <h2>{kind === 'fb2' ? 'Room for your next read.' : 'Your documents, together.'}</h2>
    <p>{kind === 'fb2' ? 'Your family’s FB2 books will live here.' : 'Your songbooks and DOCX documents will live here.'}</p>
    <span class="stage-note">Uploads arrive in Stage 2.</span>
  </section>
</main>
