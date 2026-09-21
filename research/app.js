import {loadVault, snapshotAge} from './adapter.js';
const state = { vault: null, activeNote: null, aliasMap: new Map(), activeTag: null, searchResults: [], searchIndex: 0, outlineObserver: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const noteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/></svg>';

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[：:（）()／/]/g, "-").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function resolveNote(target) {
  return state.aliasMap.get(String(target).trim().toLowerCase()) || null;
}

function renderInline(raw) {
  const tokens = [];
  const protect = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(raw).replace(/\x00/g, '');
  text = text.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const [targetWithHeading, label] = inner.split("|");
    const [target,section] = targetWithHeading.split("#");
    const note = resolveNote(target);
    if (!note) return protect('<span class="wikilink unresolved">未提供的參照</span>');
    return protect(`<a class="wikilink" href="#/note/${note.id}${section?'/section/'+slugify(section):''}">${escapeHtml(label || note.title)}</a>`);
  });
  text=text.replace(/(!?)\[([^\]]*)\]\((assets\/[a-f0-9]{64}\.(?:png|jpg|jpeg|webp|gif|pdf))\)/g,(_,embed,label,url)=>{
    if(!Object.hasOwn(state.vault.assets,url))return protect('<span>附件未提供</span>');
    return protect(embed&&!url.endsWith('.pdf')?`<img class="note-attachment" src="./${url}" alt="${escapeHtml(label)}" loading="lazy">`:`<a href="./${url}" download rel="noreferrer">${escapeHtml(label||'下載附件')}</a>`);
  });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`));
  text = text.replace(/(?<!["'=])(https?:\/\/[^\s|<>]+)/g, (url) => protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`));
  text = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|\s)#([\p{Letter}\p{Number}_-]+)/gu, '$1<button class="inline-tag" data-tag="$2">#$2</button>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

const isTableDelimiter = (line) => /^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|");
const tableCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

function beginsBlock(lines, index) {
  const line = lines[index] || "";
  const next = lines[index + 1] || "";
  return !line.trim() || /^#{1,6}\s/.test(line) || /^```/.test(line) || /^>/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || (line.includes("|") && isTableDelimiter(next));
}

function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^```\s*(\w*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      html.push(`<pre><code data-language="${escapeHtml(fence[1])}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const id = slugify(heading[2].replace(/[*_`]/g, ""));
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    const callout = line.match(/^>\s*\[!([\w-]+)\]\s*(.*)$/);
    if (callout) {
      const body = [];
      index += 1;
      while (index < lines.length && /^>/.test(lines[index])) body.push(lines[index++].replace(/^>\s?/, ""));
      const type = callout[1].toLowerCase();
      const fallback = { info: "資訊", abstract: "摘要", warning: "注意", important: "重要" }[type] || type;
      html.push(`<aside class="callout callout-${escapeHtml(type)}"><div class="callout-title">${renderInline(callout[2] || fallback)}</div><div class="callout-body">${renderMarkdown(body.join("\n"))}</div></aside>`);
      continue;
    }

    if (line.includes("|") && isTableDelimiter(lines[index + 1] || "")) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      const matcher = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index].match(matcher);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !beginsBlock(lines, index)) paragraph.push(lines[index++].trim());
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }
  return html.join("");
}

function routeTo(noteId, section = "") {
  const route = `#/note/${noteId}${section ? `/section/${section}` : ""}`;
  if (location.hash === route) handleRoute(); else location.hash = route;
}

function parseRoute() {
  const match = location.hash.match(/^#\/note\/([^/]+)(?:\/section\/(.+))?$/);
  try {return match ? { noteId: decodeURIComponent(match[1]), section: match[2] ? decodeURIComponent(match[2]) : "" } : null;}catch{return null;}
}

function renderNoteList() {
  const notes = state.activeTag ? state.vault.notes.filter((note) => note.tags.includes(state.activeTag)) : state.vault.notes;
  $("#note-list").innerHTML = notes.map((note) => `<button class="note-link ${note.id === state.activeNote?.id ? "active" : ""}" data-note-id="${note.id}">${noteIcon}<span>${escapeHtml(note.fileName)}</span></button>`).join("") || '<div class="empty-small">沒有符合的筆記</div>';
}

function renderTags() {
  const tags = [...new Set(state.vault.notes.flatMap((note) => note.tags))]
    .map((tag) => ({ tag, count: state.vault.notes.filter((note) => note.tags.includes(tag)).length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  $("#tag-list").innerHTML = tags.map(({ tag, count }) => `<button class="tag-row ${state.activeTag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><span class="tag-count">${count}</span></button>`).join("");
  $("#clear-tag").classList.toggle("hidden", !state.activeTag);
}

function setSidebarTab(tab) {
  $$(".sidebar-tab").forEach((button) => button.classList.toggle("active", button.dataset.sidebarTab === tab));
  $("#files-panel").classList.toggle("hidden", tab !== "files");
  $("#tags-panel").classList.toggle("hidden", tab !== "tags");
}

function setInspectorTab(tab) {
  $$(".inspector-tab").forEach((button) => button.classList.toggle("active", button.dataset.inspectorTab === tab));
  ["outline", "links", "info"].forEach((name) => $(`#${name}-panel`).classList.toggle("hidden", name !== tab));
}

function renderInspector(note) {
  const headings = note.headings.filter((heading) => heading.level > 1 && heading.level < 5);
  $("#outline").innerHTML = headings.map((heading) => `<button class="outline-link level-${heading.level}" data-section="${heading.id}">${escapeHtml(heading.text)}</button>`).join("") || '<div class="empty-small">這篇筆記沒有章節</div>';
  const backlinks = state.vault.notes.filter((candidate) => candidate.id !== note.id && candidate.links.some((link) => resolveNote(link)?.id === note.id));
  const outgoing = note.links.map(resolveNote).filter(Boolean);
  $("#backlink-count").textContent = backlinks.length;
  $("#backlinks").innerHTML = backlinks.map((item) => `<button class="related-link" data-note-id="${item.id}">${escapeHtml(item.fileName)}</button>`).join("") || '<div class="empty-small">目前沒有其他筆記連到這裡</div>';
  $("#outgoing-links").innerHTML = outgoing.map((item) => `<button class="related-link" data-note-id="${item.id}">${escapeHtml(item.fileName)}</button>`).join("") || '<div class="empty-small">沒有連到其他筆記</div>';
  const values = [["類型", note.type], ["狀態", note.status || "—"], ["建立", note.created || "—"], ["更新", note.updated || "—"], ["路徑", note.path], ["字數", note.words.toLocaleString("zh-Hant")], ["連結", String(note.links.length)]];
  $("#properties").innerHTML = values.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
  requestAnimationFrame(() => drawGraph($("#mini-graph"), true));
}

function observeOutline() {
  state.outlineObserver?.disconnect();
  const headings = $$("h2, h3, h4", $("#note-content"));
  if (!headings.length) return;
  state.outlineObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) $$(".outline-link").forEach((link) => link.classList.toggle("active", link.dataset.section === visible.target.id));
  }, { root: $("#workspace"), rootMargin: "-8% 0px -78% 0px", threshold: 0 });
  headings.forEach((heading) => state.outlineObserver.observe(heading));
}

function renderPagination(note) {
  const index = state.vault.notes.findIndex((item) => item.id === note.id);
  const previous = state.vault.notes[index - 1];
  const next = state.vault.notes[index + 1];
  $("#note-pagination").innerHTML = `${previous ? `<button class="page-link" data-note-id="${previous.id}"><span>← 上一篇</span><strong>${escapeHtml(previous.fileName)}</strong></button>` : "<span></span>"}${next ? `<button class="page-link" data-note-id="${next.id}"><span>下一篇 →</span><strong>${escapeHtml(next.fileName)}</strong></button>` : ""}`;
}

function selectNote(note, section = "") {
  if (!note) return;
  state.activeNote = note;
  document.title = `${note.title} · Research Vault`;
  $("#topbar-path").textContent = note.path;
  $("#note-kicker").innerHTML = `<span class="type-pill">${escapeHtml(note.type)}</span><span>${escapeHtml(note.updated || note.created || "未標日期")}</span><span>·</span><span>${note.words.toLocaleString("zh-Hant")} 字</span>`;
  $("#note-title").textContent = note.title;
  $("#note-tags").innerHTML = note.tags.map((tag) => `<button class="tag-chip" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join("");
  $("#note-content").innerHTML = renderMarkdown(note.body);
  $("#status-words").textContent = `${note.words.toLocaleString("zh-Hant")} 字`;
  $("#status-updated").textContent = note.updated ? `更新 ${note.updated}` : "";
  renderNoteList(); renderInspector(note); renderPagination(note); observeOutline();
  if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: "start" })); else $("#workspace").scrollTop = 0;
  document.body.classList.remove("sidebar-open", "inspector-open");
}

function handleRoute() {
  if (!state.vault) return;
  if (!state.vault.notes.length) {
    state.activeNote=null;state.outlineObserver?.disconnect();
    $('#note-title').textContent=state.vault.audience==='public'?'目前沒有公開筆記':'目前沒有筆記';
    $('#note-content').innerHTML='<p>此快照未包含可閱讀內容。搜尋與圖譜也不包含其他筆記。</p>';
    for(const id of ['note-kicker','note-tags','note-pagination','outline','backlinks','outgoing-links','properties','topbar-path'])$('#'+id).textContent='';
    $('#status-words').textContent='0 字';$('#status-updated').textContent='';$('#backlink-count').textContent='0';drawGraph($('#mini-graph'),true);return;
  }
  const route = parseRoute();
  const indexNote = state.vault.notes.find((item) => item.fileName === "Research Index") || state.vault.notes[0];
  const note = route ? state.vault.notes.find((item) => item.id === route.noteId) : indexNote;
  if (!route && note) history.replaceState(null, "", `#/note/${note.id}`);
  selectNote(note || indexNote, route?.section || "");
}

function chooseTag(tag) {
  state.activeTag = tag;
  renderTags(); renderNoteList(); setSidebarTab("tags");
  document.body.classList.add("sidebar-open");
  showToast(tag ? `正在查看 #${tag}` : "已清除標籤篩選");
}

const stripMarkdown = (markdown) => markdown.replace(/https?:\/\/\S+/g, " ").replace(/[#>*_`|\[\]()]/g, " ").replace(/\s+/g, " ").trim();
function highlighted(value, query) {
  const safe = escapeHtml(value);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return query ? safe.replace(new RegExp(`(${escapedQuery})`, "ig"), "<mark>$1</mark>") : safe;
}

function searchVault(query) {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  if (!needle) return [];
  return state.vault.notes.map((note) => {
    const title = `${note.title} ${note.fileName} ${note.aliases.join(" ")}`.toLocaleLowerCase("zh-Hant");
    const tags = note.tags.join(" ").toLocaleLowerCase("zh-Hant");
    const body = stripMarkdown(note.body);
    const position = body.toLocaleLowerCase("zh-Hant").indexOf(needle);
    const score = (title.includes(needle) ? 8 : 0) + (tags.includes(needle) ? 5 : 0) + (position >= 0 ? 2 : 0);
    const start = Math.max(0, position >= 0 ? position - 46 : 0);
    return { note, score, snippet: `${start > 0 ? "…" : ""}${body.slice(start, start + 150)}${body.length > start + 150 ? "…" : ""}` };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score);
}

function renderSearch(query) {
  state.searchResults = searchVault(query);
  state.searchIndex = Math.min(state.searchIndex, Math.max(0, state.searchResults.length - 1));
  $("#search-hint").classList.toggle("hidden", Boolean(query));
  $("#search-results").innerHTML = query ? (state.searchResults.map((result, index) => `<button class="search-result ${index === state.searchIndex ? "selected" : ""}" data-search-index="${index}"><span class="search-result-head"><strong>${highlighted(result.note.fileName, query)}</strong><span>${escapeHtml(result.note.type)}</span></span><p>${highlighted(result.snippet, query)}</p></button>`).join("") || '<div class="search-hint">沒有符合的筆記，試試較短的關鍵字。</div>') : "";
}

function openSearch() {
  const dialog = $("#search-dialog");
  if (!dialog.open) dialog.showModal();
  $("#search-input").value = ""; renderSearch("");
  setTimeout(() => $("#search-input").focus(), 20);
}

function openSearchResult() {
  const result = state.searchResults[state.searchIndex];
  if (!result) return;
  $("#search-dialog").close(); routeTo(result.note.id);
}

function graphData() {
  const notes = state.vault.notes;
  const popularTags = [...new Set(notes.flatMap((note) => note.tags))]
    .map((tag) => ({ tag, count: notes.filter((note) => note.tags.includes(tag)).length }))
    .filter((item) => item.count > 1).sort((a, b) => b.count - a.count).slice(0, 9);
  const nodes = [
    ...notes.map((note, index) => ({ id: note.id, label: note.fileName, type: "note", note, x: Math.cos((index / notes.length) * Math.PI * 2) * .23 + .5, y: Math.sin((index / notes.length) * Math.PI * 2) * .24 + .5 })),
    ...popularTags.map((item, index) => ({ id: `tag-${item.tag}`, label: `#${item.tag}`, type: "tag", x: Math.cos((index / popularTags.length) * Math.PI * 2 + .5) * .42 + .5, y: Math.sin((index / popularTags.length) * Math.PI * 2 + .5) * .4 + .5 })),
  ];
  const edges = [];
  notes.forEach((note) => {
    note.links.forEach((link) => { const target = resolveNote(link); if (target) edges.push([note.id, target.id]); });
    note.tags.forEach((tag) => { if (popularTags.some((item) => item.tag === tag)) edges.push([note.id, `tag-${tag}`]); });
  });
  return { nodes, edges };
}

function drawGraph(canvas, compact = false) {
  if (!canvas || !state.vault) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d"); context.scale(ratio, ratio);
  const { nodes, edges } = graphData();
  const inset = compact ? 24 : 58; const width = rect.width - inset * 2; const height = rect.height - inset * 2;
  const point = (node) => ({ x: inset + node.x * width, y: inset + node.y * height });
  const colors = getComputedStyle(document.documentElement);
  const border = colors.getPropertyValue("--border").trim(); const muted = colors.getPropertyValue("--muted").trim();
  const accent = colors.getPropertyValue("--accent").trim(); const cyan = colors.getPropertyValue("--cyan").trim();
  context.clearRect(0, 0, rect.width, rect.height); context.lineWidth = compact ? .7 : 1; context.strokeStyle = border;
  edges.forEach(([sourceId, targetId]) => {
    const source = nodes.find((node) => node.id === sourceId); const target = nodes.find((node) => node.id === targetId);
    if (!source || !target) return;
    const a = point(source); const b = point(target); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  });
  nodes.forEach((node) => {
    const { x, y } = point(node); const active = node.id === state.activeNote?.id;
    const radius = active ? (compact ? 5 : 8) : (node.type === "note" ? (compact ? 3.8 : 6) : (compact ? 2.5 : 4));
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fillStyle = node.type === "note" ? accent : cyan;
    context.shadowColor = context.fillStyle; context.shadowBlur = active ? 15 : 7; context.fill(); context.shadowBlur = 0;
    if (!compact) {
      context.fillStyle = muted; context.font = `${node.type === "note" ? 12 : 10}px Inter, sans-serif`; context.textAlign = "center";
      context.fillText(node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label, x, y + (node.type === "note" ? 21 : 16));
    }
  });
  canvas._graphNodes = nodes.map((node) => ({ ...node, ...point(node) }));
}

function handleGraphClick(event) {
  const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left; const y = event.clientY - rect.top;
  const node = canvas._graphNodes?.find((candidate) => Math.hypot(candidate.x - x, candidate.y - y) < 14);
  if (node?.note) { $("#graph-dialog").close(); routeTo(node.note.id); }
}

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 1700);
}

function bindEvents() {
  window.addEventListener("hashchange", handleRoute);
  $("#home-button").addEventListener("click", () => {const note=state.vault?.notes.find((note) => note.fileName === "Research Index") || state.vault?.notes[0];if(note)routeTo(note.id);});
  $("#note-list").addEventListener("click", (event) => { const target = event.target.closest("[data-note-id]"); if (target) routeTo(target.dataset.noteId); });
  $("#note-card").addEventListener("click", (event) => { const tag = event.target.closest("[data-tag]"); if (tag) chooseTag(tag.dataset.tag); });
  $("#note-pagination").addEventListener("click", (event) => { const target = event.target.closest("[data-note-id]"); if (target) routeTo(target.dataset.noteId); });
  $$(".sidebar-tab").forEach((button) => button.addEventListener("click", () => setSidebarTab(button.dataset.sidebarTab)));
  $$(".inspector-tab").forEach((button) => button.addEventListener("click", () => setInspectorTab(button.dataset.inspectorTab)));
  $("#tag-list").addEventListener("click", (event) => { const target = event.target.closest("[data-tag]"); if (target) chooseTag(target.dataset.tag); });
  $("#clear-tag").addEventListener("click", () => chooseTag(null));
  $("#outline").addEventListener("click", (event) => { const target = event.target.closest("[data-section]"); if (target) routeTo(state.activeNote.id, target.dataset.section); });
  $("#links-panel").addEventListener("click", (event) => { const target = event.target.closest("[data-note-id]"); if (target) routeTo(target.dataset.noteId); });
  $("#search-trigger").addEventListener("click", openSearch);
  $("#search-input").addEventListener("input", (event) => { state.searchIndex = 0; renderSearch(event.target.value); });
  $("#search-results").addEventListener("click", (event) => { const target = event.target.closest("[data-search-index]"); if (target) { state.searchIndex = Number(target.dataset.searchIndex); openSearchResult(); } });
  $("#search-input").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); state.searchIndex = Math.min(state.searchResults.length - 1, state.searchIndex + 1); renderSearch(event.currentTarget.value); }
    if (event.key === "ArrowUp") { event.preventDefault(); state.searchIndex = Math.max(0, state.searchIndex - 1); renderSearch(event.currentTarget.value); }
    if (event.key === "Enter") { event.preventDefault(); openSearchResult(); }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
    if (event.key === "Escape") document.body.classList.remove("sidebar-open", "inspector-open");
  });
  $("#theme-toggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme; try{localStorage.setItem("research-vault-theme", theme);}catch{}
    requestAnimationFrame(() => { drawGraph($("#mini-graph"), true); if ($("#graph-dialog").open) drawGraph($("#full-graph")); });
  });
  $("#sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#inspector-toggle").addEventListener("click", () => document.body.classList.toggle("inspector-open"));
  $("#drawer-scrim").addEventListener("click", () => document.body.classList.remove("sidebar-open", "inspector-open"));
  const openGraph = () => { const dialog = $("#graph-dialog"); if (!dialog.open) dialog.showModal(); requestAnimationFrame(() => drawGraph($("#full-graph"))); };
  $("#graph-open").addEventListener("click", openGraph); $("#graph-card").addEventListener("click", openGraph);
  $("#full-graph").addEventListener("click", handleGraphClick);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close()));
  window.addEventListener("resize", () => {
    clearTimeout(window.graphResize);
    window.graphResize = setTimeout(() => { drawGraph($("#mini-graph"), true); if ($("#graph-dialog").open) drawGraph($("#full-graph")); }, 120);
  });
}

let bound=false, request=0;
function updateAge() {if(state.vault)$('#snapshot-status').textContent=`${state.vault.audience==='public'?'公開白名單':state.vault.audience==='offline'?'合成示範':'私人快照'} · ${snapshotAge(state.vault)} · 來源檢查 ${new Date(state.vault.sourceObservedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}（台北時間）。不會自動同步，重新讀取不會更新來源。`;}
async function start() {
  const ticket=++request;
  const candidate=await loadVault();if(ticket!==request)return;
  state.vault=candidate;state.aliasMap.clear();state.activeTag=null;state.searchResults=[];state.searchIndex=0;
  $('#search-results').textContent='';if($('#search-dialog').open)$('#search-dialog').close();
  state.vault.notes.forEach((note) => [note.id, note.fileName, note.title, ...note.aliases].filter(Boolean).forEach((name) => state.aliasMap.set(String(name).toLowerCase(), note)));
  $("#vault-name").textContent = state.vault.vaultName;
  $("#note-count").textContent = state.vault.stats.notes;
  $("#status-note").textContent = `${state.vault.stats.notes} 篇筆記`;
  $("#vault-stats").textContent = `${state.vault.stats.notes} 篇筆記 · ${state.vault.stats.tags} 個標籤 · ${state.vault.stats.links} 條內部連結`;
  $('#load-error').textContent='';updateAge();
  renderTags(); renderNoteList(); if(!bound){bindEvents();bound=true;} handleRoute();
}

async function reload() {try{await start();}catch{$('#load-error').textContent='快照讀取或完整性檢查失敗。'+(state.vault?'保留上次成功內容，請稍後重試。':'請稍後重新讀取。');if(!state.vault){$('#note-title').textContent='無法載入知識庫';$('#note-content').textContent='';}}}
try{document.documentElement.dataset.theme=localStorage.getItem('research-vault-theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');}catch{}
$('#reload-snapshot').addEventListener('click',reload);
setInterval(updateAge,15000);
reload();
