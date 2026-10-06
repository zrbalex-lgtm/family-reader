<script>
  import Icon from './Icon.svelte';
  import { uploads, retryUpload, dismissUpload, clearFinishedUploads } from '../lib/library.js';
  const active = $derived($uploads.filter((row) => ['queued', 'processing'].includes(row.status)).length);
  const done = $derived($uploads.filter((row) => ['done', 'duplicate'].includes(row.status)).length);
</script>

{#if $uploads.length}
  <section class="upload-panel" aria-labelledby="upload-heading">
    <div class="upload-heading">
      <h2 id="upload-heading">Uploads <span class="muted" role="status">{active ? active + ' remaining' : 'Finished'}</span></h2>
      {#if done}<button class="text-button" type="button" onclick={clearFinishedUploads}>Clear finished</button>{/if}
    </div>
    <ul class="upload-list">
      {#each $uploads as row (row.id)}
        <li class="upload-row">
          <div class="upload-file">
            <strong title={row.name}>{row.title || row.name}</strong>
            {#if row.title && row.title !== row.name}<span class="upload-filename">{row.name}</span>{/if}
            <span class:error={row.status === 'failed'} class:success={row.status === 'done'} class="upload-message">
              {#if row.status === 'done'}<Icon name="check" size={16} />{/if}
              {row.message}
              {#if row.status === 'processing' && row.percent !== null}<span>{row.percent}%</span>{/if}
            </span>
            {#if row.status === 'processing'}
              <progress max="100" value={row.percent ?? undefined} aria-label={'Upload progress for ' + row.name}></progress>
            {/if}
            {#each row.warnings as warning}<span class="upload-warning">{warning}</span>{/each}
          </div>
          {#if row.status === 'failed' && row.file}<button class="text-button" type="button" onclick={() => retryUpload(row.id)}>Retry</button>{/if}
          {#if !['processing', 'queued'].includes(row.status)}
            <button class="icon-button" type="button" onclick={() => dismissUpload(row.id)} aria-label={'Dismiss ' + row.name}><Icon name="close" size={18} /></button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
