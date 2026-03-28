// ============================================================
//  Novel Reader – epub-style dynamic pagination
// ============================================================

(function () {
  'use strict';

  // ---- State ----
  const STORAGE_USER = 'novel_user';
  const STORAGE_HL   = 'novel_highlights';
  const STORAGE_CMT  = 'novel_comments';
  const STORAGE_SIZE = 'novel_text_size';
  let currentUser    = null;
  let allBlocks      = [];
  let paginatedPages = [];
  let currentSpread  = 0;
  let isMobile       = false;
  let highlights     = [];
  let comments       = [];
  let isAnimating    = false;
  let textSize       = 16;

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ---- Init ----
  function init() {
    buildBlockList();
    detectMobile();
    loadUser();
    loadHighlights();
    resolveHighlightPositions();
    loadComments();
    loadTextSize();
    bindEvents();

    // Wait for fonts to load before measuring & paginating
    document.fonts.ready.then(() => {
      paginateContent();
      populateToc();
      renderSpread();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const anchor = getAnchorBlock();
        detectMobile();
        paginateContent();
        populateToc();
        restoreFromAnchor(anchor);
        renderSpread();
      }, 250);
    });
  }

  // ---- Anchor helpers for position preservation ----
  function getAnchorBlock() {
    const pp = pagesPerSpread();
    const page = paginatedPages[currentSpread * pp];
    return page ? page.blocks[0] : null;
  }

  function restoreFromAnchor(anchor) {
    if (anchor) {
      for (let i = 0; i < paginatedPages.length; i++) {
        if (paginatedPages[i].blocks.indexOf(anchor) !== -1) {
          currentSpread = Math.floor(i / pagesPerSpread());
          break;
        }
      }
    }
    currentSpread = Math.min(currentSpread, Math.max(0, totalSpreads() - 1));
  }

  // ---- Content: flatten NOVEL_DATA into a linear block stream ----
  function buildBlockList() {
    allBlocks = [];
    for (const ch of NOVEL_DATA.chapters) {
      allBlocks.push({
        type: 'chapter-start',
        chapterId: ch.id,
        chapterTitle: ch.title,
        chapterSubtitle: ch.subtitle
      });

      let paraIdx = 0;
      let isFirst = true;

      // Support both flat (paragraphs) and nested (pages) content structures
      const paragraphs = ch.paragraphs
        ? ch.paragraphs
        : ch.pages.flatMap(p => p.paragraphs);

      for (const para of paragraphs) {
        allBlocks.push({
          type: 'paragraph',
          chapterId: ch.id,
          chapterTitle: ch.title,
          chapterSubtitle: ch.subtitle,
          paraIdx: paraIdx++,
          text: para,
          isFirstInChapter: isFirst
        });
        isFirst = false;
      }
    }
  }

  // ---- Dynamic pagination ----
  function paginateContent() {
    const refPage = isMobile ? $('#page-right') : $('#page-left');
    if (!refPage || refPage.offsetWidth === 0) return;

    // Create off-screen measurer matching the real page exactly
    const measurer = document.createElement('div');
    measurer.className = 'page page-left';
    measurer.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
    measurer.style.width = refPage.offsetWidth + 'px';
    measurer.style.height = refPage.offsetHeight + 'px';
    measurer.innerHTML = '<div class="page-header"><span class="page-chapter">M</span><span class="page-num">0</span></div><div class="page-content"></div>';
    document.body.appendChild(measurer);

    const contentEl = measurer.querySelector('.page-content');
    // Force font size to match current setting
    contentEl.style.fontSize = textSize + 'px';
    // Force reflow so clientHeight is accurate
    void contentEl.offsetHeight;
    const maxHeight = contentEl.clientHeight;

    paginatedPages = [];
    let blockIdx = 0;
    let pageNum = 1;

    while (blockIdx < allBlocks.length) {
      contentEl.innerHTML = '';
      const pageBlocks = [];

      while (blockIdx < allBlocks.length) {
        const block = allBlocks[blockIdx];

        // Force a page break before a new chapter if there's already content
        if (block.type === 'chapter-start' && pageBlocks.length > 0) break;

        const el = createBlockEl(block, pageBlocks, false);
        contentEl.appendChild(el);

        // Check overflow; allow at least one block per page
        if (contentEl.scrollHeight > maxHeight + 1 && pageBlocks.length > 0) {
          contentEl.removeChild(el);
          break;
        }

        pageBlocks.push(block);
        blockIdx++;
      }

      if (pageBlocks.length > 0) {
        const first = pageBlocks.find(b => b.type !== 'chapter-start') || pageBlocks[0];
        paginatedPages.push({
          pageNum: pageNum++,
          blocks: pageBlocks,
          chapterId: first.chapterId,
          chapterTitle: first.chapterTitle || '',
          chapterSubtitle: first.chapterSubtitle || ''
        });
      }
    }

    document.body.removeChild(measurer);
  }

  function createBlockEl(block, _precedingBlocks, withHighlights) {
    if (block.type === 'chapter-start') {
      const div = document.createElement('div');
      div.className = 'chapter-heading';
      let html = '<h2>' + escapeHtml(block.chapterTitle) + '</h2>';
      if (block.chapterSubtitle) html += '<h3>' + escapeHtml(block.chapterSubtitle) + '</h3>';
      div.innerHTML = html;
      return div;
    }

    const p = document.createElement('p');
    if (block.isFirstInChapter) p.className = 'first-para-after-heading';
    p.setAttribute('data-chapter', block.chapterId);
    p.setAttribute('data-para', String(block.paraIdx));
    p.id = 'p-' + block.chapterId + '-' + block.paraIdx;

    if (withHighlights) {
      p.innerHTML = applyHighlightsToText(block.text, block.chapterId, block.paraIdx);
    } else {
      p.innerHTML = block.text;
    }
    return p;
  }

  function detectMobile() { isMobile = window.innerWidth <= 768; }

  // ---- Text Size ----
  function loadTextSize() {
    try {
      const saved = localStorage.getItem(STORAGE_SIZE);
      if (saved) textSize = parseInt(saved);
    } catch (e) { /* ignore */ }
    textSize = Math.max(12, Math.min(22, textSize || 16));
    applyTextSize();
  }

  function applyTextSize() {
    document.documentElement.style.setProperty('--reader-font-size', textSize + 'px');
  }

  function changeTextSize(delta) {
    textSize = Math.max(12, Math.min(22, textSize + delta));
    localStorage.setItem(STORAGE_SIZE, String(textSize));
    applyTextSize();

    const anchor = getAnchorBlock();
    paginateContent();
    populateToc();
    restoreFromAnchor(anchor);
    renderSpread();
  }

  // ---- Auth ----
  function loadUser() {
    try {
      const saved = localStorage.getItem(STORAGE_USER);
      if (saved) {
        currentUser = JSON.parse(saved);
        // Migrate old format: use email as userId if no userId yet
        if (!currentUser.userId) {
          currentUser.userId = currentUser.email || uuid();
          localStorage.setItem(STORAGE_USER, JSON.stringify(currentUser));
        }
      }
    } catch (e) { /* ignore */ }
    updateUserButton();
    if (!currentUser) showAuthModal();
  }

  function saveUser(name) {
    currentUser = { name, userId: uuid() };
    localStorage.setItem(STORAGE_USER, JSON.stringify(currentUser));
    updateUserButton();
  }

  function updateUserButton() {
    const btn = $('#btn-user');
    if (currentUser) { btn.textContent = currentUser.name; btn.title = ''; }
    else { btn.textContent = 'Sign In'; }
  }

  function showAuthModal() { $('#auth-modal').classList.add('visible'); }
  function hideAuthModal() { $('#auth-modal').classList.remove('visible'); }

  // ---- Highlights ----
  function loadHighlights() {
    try { const s = localStorage.getItem(STORAGE_HL); if (s) highlights = JSON.parse(s); } catch (e) { highlights = []; }
  }
  function saveHighlights() { localStorage.setItem(STORAGE_HL, JSON.stringify(highlights)); }
  function addHighlight(hl) { highlights.push(hl); saveHighlights(); resolveHighlightPositions(); }

  // Resolve each highlight's position by searching the current novel text.
  // Stores _resolved and _resolvedParaIdx in-memory (not persisted).
  // This makes highlights survive paragraph reordering across version uploads.
  function resolveHighlightPositions() {
    for (const hl of highlights) {
      const chapter = NOVEL_DATA.chapters.find(function (c) { return c.id === hl.chapterId; });
      if (!chapter) { hl._resolved = false; continue; }
      const idx = chapter.paragraphs.findIndex(function (p) { return p.includes(hl.text); });
      if (idx !== -1) {
        hl._resolvedParaIdx = idx;
        hl._resolved = true;
      } else {
        hl._resolved = false;
      }
    }
  }

  // ---- Comments ----
  function loadComments() {
    try { const s = localStorage.getItem(STORAGE_CMT); if (s) comments = JSON.parse(s); } catch (e) { comments = []; }
  }
  function saveComments() { localStorage.setItem(STORAGE_CMT, JSON.stringify(comments)); }
  function addComment(cmt) { comments.push(cmt); saveComments(); }

  // ---- Navigation ----
  function pagesPerSpread() { return isMobile ? 1 : 2; }
  function totalSpreads() { return Math.ceil(paginatedPages.length / pagesPerSpread()); }

  function goToSpread(idx) {
    const newSpread = Math.max(0, Math.min(idx, totalSpreads() - 1));
    if (newSpread === currentSpread || isAnimating) return;

    const direction = newSpread > currentSpread ? 'forward' : 'backward';
    const container = $('.book-container');
    isAnimating = true;

    const overlay = document.createElement('div');
    overlay.className = 'page-flip-overlay flip-' + direction;

    if (!isMobile) {
      // Capture departing page content before renderSpread replaces it
      const departingEl = direction === 'forward' ? $('#page-right') : $('#page-left');
      const deptHeader = departingEl.querySelector('.page-header').innerHTML;
      const deptContent = departingEl.querySelector('.page-content').innerHTML;

      const frontFace = document.createElement('div');
      frontFace.className = 'flip-face flip-front';
      frontFace.innerHTML =
        '<div class="page-header">' + deptHeader + '</div>' +
        '<div class="page-content">' + deptContent + '</div>';
      overlay.appendChild(frontFace);
    }

    container.appendChild(overlay);
    currentSpread = newSpread;
    renderSpread();

    if (!isMobile) {
      // Capture arriving page content after renderSpread has populated it
      const arrivingEl = direction === 'forward' ? $('#page-left') : $('#page-right');
      const arrvHeader = arrivingEl.querySelector('.page-header').innerHTML;
      const arrvContent = arrivingEl.querySelector('.page-content').innerHTML;

      const backFace = document.createElement('div');
      backFace.className = 'flip-face flip-back';
      backFace.innerHTML =
        '<div class="page-header">' + arrvHeader + '</div>' +
        '<div class="page-content">' + arrvContent + '</div>';
      overlay.appendChild(backFace);
    }

    overlay.addEventListener('animationend', function () {
      overlay.remove();
      isAnimating = false;
    });
  }

  function goToChapter(chapterId) {
    const idx = paginatedPages.findIndex(p =>
      p.blocks.some(b => b.type === 'chapter-start' && b.chapterId === chapterId)
    );
    if (idx === -1) return;
    currentSpread = Math.floor(idx / pagesPerSpread());
    renderSpread();
  }

  // ---- Render ----
  function renderSpread() {
    if (paginatedPages.length === 0) return;

    const pp = pagesPerSpread();
    const start = currentSpread * pp;
    const pages = paginatedPages.slice(start, start + pp);

    const pageLeft = $('#page-left');
    const pageRight = $('#page-right');
    const spine = $('.page-spine');

    if (isMobile) {
      pageLeft.classList.add('hidden-mobile');
      spine.classList.add('hidden-mobile');
      if (pages[0]) { renderPage(pageRight, pages[0]); pageRight.classList.remove('empty-page'); }
    } else {
      pageLeft.classList.remove('hidden-mobile');
      spine.classList.remove('hidden-mobile');
      if (pages[0]) { renderPage(pageLeft, pages[0]); pageLeft.classList.remove('empty-page'); }
      else clearPage(pageLeft);
      if (pages[1]) { renderPage(pageRight, pages[1]); pageRight.classList.remove('empty-page'); }
      else clearPage(pageRight);
    }

    $('#nav-prev').disabled = currentSpread <= 0;
    $('#nav-next').disabled = currentSpread >= totalSpreads() - 1;

    const first = pages[0] ? pages[0].pageNum : '?';
    const last = pages[pages.length - 1] ? pages[pages.length - 1].pageNum : first;
    const total = paginatedPages.length;
    if (isMobile || pages.length === 1 || first === last) {
      $('#page-indicator').textContent = 'Page ' + first + ' of ' + total;
    } else {
      $('#page-indicator').textContent = 'Pages ' + first + '\u2013' + last + ' of ' + total;
    }

    updateProgress();
    updateTocHighlight();
  }

  function renderPage(el, pageData) {
    el.querySelector('.page-chapter').textContent = pageData.chapterTitle +
      (pageData.chapterSubtitle ? ' \u2013 ' + pageData.chapterSubtitle : '');
    el.querySelector('.page-num').textContent = pageData.pageNum;

    const content = el.querySelector('.page-content');
    content.innerHTML = '';
    for (let i = 0; i < pageData.blocks.length; i++) {
      content.appendChild(createBlockEl(pageData.blocks[i], pageData.blocks.slice(0, i), true));
    }
  }

  function clearPage(el) {
    el.querySelector('.page-chapter').textContent = '';
    el.querySelector('.page-num').textContent = '';
    el.querySelector('.page-content').innerHTML = '';
    el.classList.add('empty-page');
  }

  // ---- Highlights: resolved by text search across versions ----
  function applyHighlightsToText(text, chapterId, paraIdx) {
    const matches = highlights.filter(function (h) {
      return h._resolved && h.chapterId === chapterId && h._resolvedParaIdx === paraIdx;
    });
    if (matches.length === 0) return text;
    let result = text;
    for (const hl of matches) {
      if (hl.text && result.includes(hl.text)) {
        result = result.replace(
          hl.text,
          '<span class="user-highlight" data-hl-id="' + hl.id + '" title="Highlighted by ' + hl.userName + '">' + hl.text + '</span>'
        );
      }
    }
    return result;
  }


  // ---- Text Selection & Highlight ----
  let selectionData = null;

  function handleTextSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') { hideHighlightToolbar(); return; }

    const text = sel.toString().trim();
    let paraEl = sel.anchorNode;
    if (paraEl.nodeType === 3) paraEl = paraEl.parentElement;
    while (paraEl && paraEl.tagName !== 'P') paraEl = paraEl.parentElement;
    if (!paraEl || !paraEl.dataset.chapter) { hideHighlightToolbar(); return; }

    selectionData = { text, chapterId: paraEl.dataset.chapter, paraIdx: parseInt(paraEl.dataset.para) };

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const toolbar = $('#highlight-toolbar');
    toolbar.style.left = Math.max(8, rect.left + rect.width / 2 - 80) + 'px';
    toolbar.style.top = (rect.top - 44) + 'px';
    toolbar.classList.add('visible');
  }

  function hideHighlightToolbar() { $('#highlight-toolbar').classList.remove('visible'); selectionData = null; }

  function doHighlight() {
    if (!selectionData) return;
    if (!currentUser) { showAuthModal(); return; }
    const hl = {
      id: uuid(), userId: currentUser.userId, userName: currentUser.name,
      chapterId: selectionData.chapterId, paraIdx: selectionData.paraIdx,
      text: selectionData.text, timestamp: new Date().toISOString()
    };
    addHighlight(hl);
    window.getSelection().removeAllRanges();
    hideHighlightToolbar();
    renderSpread();
  }

  function doHighlightAndComment() {
    if (!selectionData) return;
    if (!currentUser) { showAuthModal(); return; }
    const hl = {
      id: uuid(), userId: currentUser.userId, userName: currentUser.name,
      chapterId: selectionData.chapterId, paraIdx: selectionData.paraIdx,
      text: selectionData.text, timestamp: new Date().toISOString()
    };
    addHighlight(hl);
    window.getSelection().removeAllRanges();
    hideHighlightToolbar();
    renderSpread();
    openCommentModal('paragraph', hl.chapterId, hl.paraIdx, hl.id, hl.text);
  }

  // ---- Comments UI ----
  function getCurrentChapterId() {
    const page = paginatedPages[currentSpread * pagesPerSpread()];
    return page ? page.chapterId : NOVEL_DATA.chapters[0].id;
  }

  function openCommentModal(level, chapterId, paraIdx, highlightId, contextText) {
    if (!currentUser) { showAuthModal(); return; }
    $('#comment-level').value = level;
    $('#comment-chapter').value = chapterId || '';
    $('#comment-page').value = '';
    $('#comment-para').value = paraIdx !== undefined ? paraIdx : '';
    $('#comment-highlight-id').value = highlightId || '';
    $('#comment-text').value = '';

    const labels = { paragraph: 'Comment on Passage', page: 'Comment on Section', chapter: 'Comment on Chapter', novel: 'Comment on Novel' };
    $('#comment-modal-title').textContent = labels[level] || 'Add Comment';
    const ctx = $('#comment-context');
    ctx.textContent = contextText ? '\u201C' + contextText + '\u201D' : '';

    renderExistingComments(level, chapterId, paraIdx, highlightId);
    $('#comment-modal').classList.add('visible');
    $('#comment-text').focus();
  }

  function renderExistingComments(level, chapterId, paraIdx, highlightId) {
    const container = $('#existing-comments');
    const myId = currentUser ? currentUser.userId : null;
    const mine = myId ? comments.filter(c => c.userId === myId) : [];
    let filtered = [];
    if (highlightId) filtered = mine.filter(c => c.highlightId === highlightId);
    else if (level === 'paragraph') filtered = mine.filter(c => c.level === 'paragraph' && c.chapterId === chapterId && c.paraIdx === paraIdx);
    else if (level === 'chapter' || level === 'page') filtered = mine.filter(c => (c.level === 'chapter' || c.level === 'page') && c.chapterId === chapterId);
    else filtered = mine.filter(c => c.level === 'novel');

    if (filtered.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = '<h4 style="font-size:13px;margin-bottom:8px;color:var(--text-muted)">Previous Comments</h4>' +
      filtered.map(c => '<div class="comment-item"><div class="comment-meta"><strong>' + escapeHtml(c.userName) + '</strong> &middot; ' + new Date(c.timestamp).toLocaleDateString() + '</div><div class="comment-body">' + escapeHtml(c.text) + '</div></div>').join('');
  }

  function submitComment(e) {
    e.preventDefault();
    if (!currentUser) { showAuthModal(); return; }
    const text = $('#comment-text').value.trim();
    if (!text) return;
    addComment({
      id: uuid(), userId: currentUser.userId, userName: currentUser.name,
      level: $('#comment-level').value, chapterId: $('#comment-chapter').value || null,
      paraIdx: $('#comment-para').value !== '' ? parseInt($('#comment-para').value) : null,
      highlightId: $('#comment-highlight-id').value || null,
      text: text, timestamp: new Date().toISOString()
    });
    $('#comment-modal').classList.remove('visible');
    $('#comment-text').value = '';
  }

  // ---- Progress Bar ----
  function updateProgress() {
    const total = totalSpreads();
    const pct = total <= 1 ? 100 : Math.round((currentSpread + 1) / total * 100);
    const bar = $('#progress-bar');
    if (bar) bar.style.width = pct + '%';
  }

  // ---- TOC Sidebar ----
  function populateToc() {
    const list = $('#toc-list');
    list.innerHTML = '';
    for (const ch of NOVEL_DATA.chapters) {
      const startPage = paginatedPages.find(function (p) {
        return p.blocks.some(function (b) { return b.type === 'chapter-start' && b.chapterId === ch.id; });
      });
      const pageNum = startPage ? startPage.pageNum : null;

      const item = document.createElement('div');
      item.className = 'toc-chapter';
      item.dataset.chapterId = ch.id;
      let html = '<div class="toc-chapter-body">';
      html += '<div class="toc-chapter-title">' + escapeHtml(ch.title) + '</div>';
      if (ch.subtitle) html += '<div class="toc-chapter-subtitle">' + escapeHtml(ch.subtitle) + '</div>';
      html += '</div>';
      if (pageNum !== null) html += '<div class="toc-page-num">' + pageNum + '</div>';
      item.innerHTML = html;
      item.addEventListener('click', function () {
        goToChapter(ch.id);
        closeTocSidebar();
      });
      list.appendChild(item);
    }
  }

  function updateTocHighlight() {
    const chId = getCurrentChapterId();
    $$('.toc-chapter').forEach(function (el) {
      el.classList.toggle('active', el.dataset.chapterId === chId);
    });
  }

  function openTocSidebar() { $('#toc-sidebar').classList.add('open'); }
  function closeTocSidebar() { $('#toc-sidebar').classList.remove('open'); }

  // ---- Comments Sidebar ----
  let sidebarScope = 'page';

  function openCommentsSidebar() { $('#comments-sidebar').classList.add('open'); renderSidebarComments(); }
  function closeCommentsSidebar() { $('#comments-sidebar').classList.remove('open'); }

  function renderSidebarComments() {
    const list = $('#sidebar-comments-list');
    let filtered = [];
    const chapterId = getCurrentChapterId();

    // Only show the current user's own comments
    const myId = currentUser ? currentUser.userId : null;
    const myComments = myId ? comments.filter(c => c.userId === myId) : [];

    if (sidebarScope === 'page') {
      const pp = pagesPerSpread();
      const start = currentSpread * pp;
      const visiblePages = paginatedPages.slice(start, start + pp);
      const visibleKeys = new Set();
      for (const pg of visiblePages) for (const b of pg.blocks) {
        if (b.type === 'paragraph') visibleKeys.add(b.chapterId + ':' + b.paraIdx);
      }
      filtered = myComments.filter(function (c) {
        if (c.highlightId) {
          const hl = highlights.find(function (h) { return h.id === c.highlightId; });
          if (!hl || !hl._resolved) return false;
          return visibleKeys.has(hl.chapterId + ':' + hl._resolvedParaIdx);
        }
        if (c.level === 'paragraph') return visibleKeys.has(c.chapterId + ':' + c.paraIdx);
        return c.level === 'page' && c.chapterId === chapterId;
      });
    } else if (sidebarScope === 'chapter') {
      filtered = myComments.filter(c => c.chapterId === chapterId);
    } else {
      filtered = myComments.filter(c => c.level === 'novel');
    }

    if (filtered.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:14px;text-align:center;padding:20px;">No comments yet.</p>';
      return;
    }
    list.innerHTML = filtered.map(c => {
      let scope = '';
      if (c.level === 'paragraph' && c.highlightId) {
        const hl = highlights.find(h => h.id === c.highlightId);
        if (hl) scope = '<div class="comment-context" style="font-size:12px;margin-bottom:4px;padding:4px 8px;">\u201C' + escapeHtml(hl.text.slice(0, 80)) + (hl.text.length > 80 ? '...' : '') + '\u201D</div>';
      }
      return '<div class="comment-item">' + scope + '<div class="comment-meta"><strong>' + escapeHtml(c.userName) + '</strong> &middot; ' + new Date(c.timestamp).toLocaleDateString() + '</div><div class="comment-body">' + escapeHtml(c.text) + '</div></div>';
    }).join('');
  }

  // ---- Diff ----
  function openDiffModal() {
    const modal = $('#diff-modal');
    const sel = $('#diff-version-select');
    sel.innerHTML = '';
    // versions[0] is the most recent commit (current); show all older ones
    const prevVersions = (NOVEL_DATA.versions || []).slice(1);
    if (prevVersions.length === 0) {
      sel.innerHTML = '<option value="">No previous versions</option>';
    } else {
      for (const v of prevVersions) {
        const opt = document.createElement('option');
        opt.value = v.sha;
        opt.textContent = v.label + ' \u2014 ' + v.date;
        sel.appendChild(opt);
      }
    }
    $('#diff-output').innerHTML = '<div class="diff-empty">Select a version and click \u201CShow Diff\u201D to compare.</div>';
    modal.classList.add('visible');
  }

  function runDiff() {
    const sha = $('#diff-version-select').value;
    const scope = $('#diff-scope-select').value;
    const output = $('#diff-output');

    if (!sha) {
      output.innerHTML = '<div class="diff-empty">No previous versions to compare against.</div>';
      return;
    }

    output.innerHTML = '<div class="diff-empty">Loading\u2026</div>';

    const rawUrl = 'https://raw.githubusercontent.com/' + NOVEL_DATA.repo + '/' + sha + '/assets/novel/novel.md';

    fetch(rawUrl)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        const oldChapters = window.parseNovelMarkdown(text);
        const chId = getCurrentChapterId();
        const newParas = getChapterParas(NOVEL_DATA.chapters, chId);
        const oldParas = getChapterParas(oldChapters, chId);

        const a = scope === 'page' ? getVisibleParas(oldParas, chId) : oldParas;
        const b = scope === 'page' ? getVisibleParas(newParas, chId) : newParas;

        if (a.length === 0 && b.length === 0) {
          output.innerHTML = '<div class="diff-empty">Chapter not found in selected version.</div>';
          return;
        }
        output.innerHTML = renderDiff(computeDiff(a, b));
      })
      .catch(function (err) {
        output.innerHTML = '<div class="diff-empty">Error loading version: ' + escapeHtml(err.message) + '</div>';
      });
  }

  function getChapterParas(chapters, chapterId) {
    const ch = chapters.find(function (c) { return c.id === chapterId; });
    return ch ? ch.paragraphs : [];
  }

  function getVisibleParas(allParas, chapterId) {
    const pp = pagesPerSpread();
    const start = currentSpread * pp;
    const visiblePages = paginatedPages.slice(start, start + pp);
    const visible = new Set();
    for (const pg of visiblePages) {
      for (const b of pg.blocks) {
        if (b.type === 'paragraph' && b.chapterId === chapterId) visible.add(b.paraIdx);
      }
    }
    return allParas.filter(function (_, i) { return visible.has(i); });
  }

  function computeDiff(oldLines, newLines) {
    const m = oldLines.length, n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    let i = m, j = n;
    const ops = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) { ops.unshift({ type: 'same', text: oldLines[i - 1] }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'add', text: newLines[j - 1] }); j--; }
      else { ops.unshift({ type: 'del', text: oldLines[i - 1] }); i--; }
    }
    return ops;
  }

  function renderDiff(ops) {
    return ops.map(op => {
      if (op.type === 'add') return '<span class="diff-add">+ ' + escapeHtml(op.text) + '</span>';
      if (op.type === 'del') return '<span class="diff-del">- ' + escapeHtml(op.text) + '</span>';
      return '<span class="diff-same">  ' + escapeHtml(op.text) + '</span>';
    }).join('');
  }

  window.novelDiff = { computeDiff, renderDiff };

  // ---- Utility ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Auth
    $('#auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#auth-name').value.trim();
      if (name) { saveUser(name); hideAuthModal(); }
    });
    $('#skip-auth').addEventListener('click', hideAuthModal);
    $('#btn-user').addEventListener('click', () => {
      showAuthModal();
      if (currentUser) { $('#auth-name').value = currentUser.name; }
    });

    // Text size
    $('#btn-size-down').addEventListener('click', () => changeTextSize(-1));
    $('#btn-size-up').addEventListener('click', () => changeTextSize(1));

    // Navigation
    $('#nav-prev').addEventListener('click', () => goToSpread(currentSpread - 1));
    $('#nav-next').addEventListener('click', () => goToSpread(currentSpread + 1));

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goToSpread(currentSpread - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goToSpread(currentSpread + 1); }
    });


    // Text selection
    document.addEventListener('mouseup', () => setTimeout(handleTextSelection, 10));
    document.addEventListener('touchend', () => setTimeout(handleTextSelection, 300));
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.highlight-toolbar')) {
        setTimeout(() => { const sel = window.getSelection(); if (!sel || sel.isCollapsed) hideHighlightToolbar(); }, 200);
      }
    });

    $('#hl-btn-highlight').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); doHighlight(); });
    $('#hl-btn-comment').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); doHighlightAndComment(); });

    document.addEventListener('click', (e) => {
      const hlEl = e.target.closest('.user-highlight');
      if (hlEl) {
        const hl = highlights.find(h => h.id === hlEl.dataset.hlId);
        if (hl) openCommentModal('paragraph', hl.chapterId, hl.paraIdx, hl.id, hl.text);
      }
    });

    // TOC sidebar
    $('#btn-toc').addEventListener('click', openTocSidebar);
    $('#close-toc-sidebar').addEventListener('click', closeTocSidebar);

    // Comments sidebar
    $('#btn-comments').addEventListener('click', openCommentsSidebar);
    $('#close-comments-sidebar').addEventListener('click', closeCommentsSidebar);
    $$('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        sidebarScope = tab.dataset.scope;
        renderSidebarComments();
      });
    });
    $('#sidebar-add-comment').addEventListener('click', () => {
      const level = sidebarScope === 'novel' ? 'novel' : sidebarScope === 'chapter' ? 'chapter' : 'page';
      openCommentModal(level, getCurrentChapterId(), undefined, null, null);
    });

    // Comment modal
    $('#comment-form').addEventListener('submit', submitComment);
    $('#close-comment-modal').addEventListener('click', () => $('#comment-modal').classList.remove('visible'));

    // Diff
    $('#btn-diff').addEventListener('click', openDiffModal);
    $('#close-diff-modal').addEventListener('click', () => $('#diff-modal').classList.remove('visible'));
    $('#run-diff').addEventListener('click', runDiff);

    // Close modals on backdrop
    $$('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => { if (e.target === modal && modal.id !== 'auth-modal') modal.classList.remove('visible'); });
    });

    // Touch swipe
    let touchStartX = 0;
    const mainEl = $('.reader-main');
    mainEl.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    mainEl.addEventListener('touchend', (e) => {
      const diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) > 60) { if (diff > 0) goToSpread(currentSpread - 1); else goToSpread(currentSpread + 1); }
    }, { passive: true });
  }

  // ---- Go ----
  // Wait for md-parser.js to fetch and populate NOVEL_DATA
  document.addEventListener('novel-data-ready', init);
})();
