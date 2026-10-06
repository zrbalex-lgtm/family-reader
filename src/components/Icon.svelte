<script>
  let { name = 'book', size = 22, filled = false } = $props();
  const paths = {
    book: 'M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V6Z',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l.7 3 2 .9L19.4 6l2 3.5-2.1 2v2l2.1 2-2 3.5-2.7-.9-2 .9-.7 3h-4l-.7-3-2-.9-2.7.9-2-3.5 2.1-2v-2l-2.1-2 2-3.5 2.7.9 2-.9.7-3Z',
    document: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    eyeOff: 'm3 3 18 18M10 5c7-1 12 7 12 7s-1 2-3 4M6 6c-2 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4',
    lock: 'M6 10h12v11H6V10Zm2 0V7a4 4 0 0 1 8 0v3m-4 5v2',
    logout: 'M9 4H4v16h5m-1-8h13m-4-4 4 4-4 4',
    back: 'm14 5-7 7 7 7M7 12h14',
    check: 'm5 12 4 4L19 6',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    close: 'm6 6 12 12M6 18 18 6',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v5m0-8.5v.5',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5',
    collapse: 'M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5',
    grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
    list: 'M4 6h3m-3 6h3m-3 6h3M10 6h10m-10 6h10m-10 6h10',
    bookmark: 'M6 3h12v18l-6-4.5L6 21V3Z',
    contents: 'M4 6h16M4 12h10M4 18h13',
    refresh: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] || paths.book} />
</svg>
