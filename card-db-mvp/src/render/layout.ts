import { esc, jsonLd } from "../util.ts";
import { currentAccount } from "../app/session-context.ts";

export type PageOpts = {
  title: string;
  description: string;
  canonical: string;
  body?: string;
  html?: string; // render functions return `html`; either is accepted
  jsonLd?: unknown[];
  searchValue?: string;
  ogImage?: string | null;
};

const SITE = "CardIndex";

// Brand mark: two offset cards on a violet→magenta tile. Inline SVG so it inherits
// crisp rendering at any size and needs no asset request. Exported for reuse on
// the auth pages. (The gradient id repeats if the mark appears twice on a page;
// browsers resolve to the first definition — same gradient, so it renders fine.)
export const BRAND_MARK = `<svg class="mark" viewBox="0 0 32 32" width="27" height="27" role="img" aria-label="CardIndex" focusable="false"><defs><linearGradient id="ciMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6bff"/><stop offset="1" stop-color="#5b8cff"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#ciMark)"/><rect x="8" y="8" width="11" height="15" rx="2.2" fill="#fff" fill-opacity="0.5" transform="rotate(-9 13.5 15.5)"/><rect x="13" y="9" width="11" height="15" rx="2.2" fill="#fff"/></svg>`;

function accountControls(): string {
  const acct = currentAccount();
  if (acct) {
    return `<div class="hdr-acct">
      <a class="acct-name" href="/app" title="Your seller workspace">${esc(acct.display_name)}</a>
      <form method="post" action="/logout" class="acct-logout-form"><button type="submit" class="acct-logout">Log out</button></form>
    </div>`;
  }
  return `<a class="hdr-signin" href="/login">Sign in</a>
    <a class="btn primary hdr-cta" href="/app/scan">Start free</a>`;
}

function header(searchValue = ""): string {
  return `
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/">${BRAND_MARK}${SITE}</a>
    <nav class="nav">
      <a href="/browse">Browse</a>
      <a href="/g/pokemon">Pokémon</a>
      <a href="/g/mtg">Magic</a>
      <a href="/search">Search</a>
      <a href="/app" class="nav-app">Seller tools</a>
    </nav>
    <div class="header-search">
      <div class="searchbox">
        <form action="/search" method="get" role="search">
          <span class="icon" aria-hidden="true">⌕</span>
          <input type="search" name="q" value="${esc(searchValue)}" placeholder="Search any card…"
                 aria-label="Search cards" autocomplete="off" data-suggest>
          <button type="submit">Search</button>
        </form>
        <div class="suggest" role="listbox" aria-label="Suggestions"></div>
      </div>
    </div>
    ${accountControls()}
    <button class="theme-toggle" type="button" aria-label="Toggle light or dark theme" title="Toggle theme">◐</button>
  </div>
</header>`;
}

function footer(): string {
  return `
<footer class="site-footer">
  <div class="wrap cols">
    <div class="about">
      <div class="brand" style="margin-bottom:10px">${BRAND_MARK}${SITE}</div>
      Live prices on every card, plus the workspace to scan, price and list your
      own — variant-aware values, per-grade comps, and one-click marketplace
      listings.
    </div>
    <div>
      <h4>Browse</h4>
      <a href="/g/pokemon">Pokémon</a>
      <a href="/g/mtg">Magic: The Gathering</a>
      <a href="/browse">All sets</a>
      <a href="/search">Search</a>
    </div>
    <div>
      <h4>Seller tools</h4>
      <a href="/app/scan">Scan &amp; identify</a>
      <a href="/app">Inventory &amp; pricing</a>
      <a href="/app/listings">eBay listings</a>
    </div>
  </div>
  <div class="wrap legal">
    <span>Catalog &amp; market prices from the Pokémon TCG API &amp; Scryfall. Grade values, price history &amp; sold comps are demo data.</span>
    <span>Phase 1 MVP — not affiliated with any marketplace.</span>
  </div>
</footer>`;
}

// Dark is the default look; the toggle can switch to light and persists the choice.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ci-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

const CLIENT_JS = `
(function(){
  // theme toggle
  var btn=document.querySelector('.theme-toggle');
  if(btn){btn.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme');
    var next = cur==='dark' ? 'light' : cur==='light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem('ci-theme',next);}catch(e){}
  });}
  // type-ahead
  document.querySelectorAll('.searchbox').forEach(function(box){
    var input=box.querySelector('input[data-suggest]');
    var panel=box.querySelector('.suggest');
    if(!input||!panel)return;
    var timer, items=[], active=-1;
    function close(){panel.classList.remove('open');panel.innerHTML='';active=-1;items=[];}
    function render(rows){
      if(!rows.length){close();return;}
      items=rows;active=-1;
      panel.innerHTML=rows.map(function(r){
        return '<a href="'+r.url+'" role="option">'+
          (r.image?'<img class="thumb" src="'+r.image+'" alt="" loading="lazy">':'<span class="thumb"></span>')+
          '<span>'+r.name+'</span><span class="s-meta">'+r.meta+'</span></a>';
      }).join('');
      panel.classList.add('open');
    }
    input.addEventListener('input',function(){
      var q=input.value.trim();
      clearTimeout(timer);
      if(q.length<2){close();return;}
      timer=setTimeout(function(){
        fetch('/api/suggest?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(render).catch(close);
      },130);
    });
    input.addEventListener('keydown',function(e){
      var links=panel.querySelectorAll('a');
      if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(active+1,links.length-1);}
      else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,-1);}
      else if(e.key==='Enter'&&active>=0){e.preventDefault();window.location=links[active].href;return;}
      else if(e.key==='Escape'){close();return;}
      else return;
      links.forEach(function(l,i){l.classList.toggle('active',i===active);});
    });
    document.addEventListener('click',function(e){if(!box.contains(e.target))close();});
  });
})();`;

// Favicon: the same violet→magenta stacked-cards mark, inlined as a data URI.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%232f6bff'/%3E%3Cstop offset='1' stop-color='%235b8cff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Crect x='8' y='8' width='11' height='15' rx='2' fill='white' fill-opacity='0.5'/%3E%3Crect x='13' y='9' width='11' height='15' rx='2' fill='white'/%3E%3C/svg%3E";

export function page(o: PageOpts): string {
  const ld = (o.jsonLd ?? [])
    .map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
${o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}">` : ""}
<meta name="theme-color" content="#080d18">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/styles.css">
<script>${THEME_INIT}</script>
${ld}
</head>
<body>
${header(o.searchValue)}
<main>
${o.html ?? o.body ?? ""}
</main>
${footer()}
<script>${CLIENT_JS}</script>
</body>
</html>`;
}
