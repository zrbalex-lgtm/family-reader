<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  let { title, onclose, busy = false, children } = $props();
  let element = $state();
  const titleId = 'dialog-' + crypto.randomUUID();
  onMount(() => {
    element.showModal();
    return () => { if (element?.open) element.close(); };
  });
  function cancel(event) {
    event.preventDefault();
    if (!busy) onclose();
  }
</script>

<dialog bind:this={element} class="modal" aria-labelledby={titleId} oncancel={cancel}>
  <div class="modal-heading">
    <h2 id={titleId}>{title}</h2>
    <button class="icon-button" type="button" onclick={onclose} disabled={busy} aria-label="Close dialog"><Icon name="close" /></button>
  </div>
  {@render children()}
</dialog>
