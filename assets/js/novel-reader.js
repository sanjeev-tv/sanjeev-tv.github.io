// ============================================================
//  Novel Reader – epub-style dynamic pagination
// ============================================================

(function () {
  'use strict';

  // ---- State ----
  const STORAGE_USER     = 'novel_user';
  const STORAGE_HL       = 'novel_highlights';
  const STORAGE_CMT      = 'novel_comments';
  const STORAGE_SIZE     = 'novel_text_size';
  const STORAGE_BOOKMARK = 'novel_bookmark';
  let currentUser       = null;
  let editingCommentId  = null;
  let allBlocks         = [];
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

    // Wait for fonts to load, then defer to next frame so the flex
    // layout is fully committed before we measure page heights.
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        paginateContent();
        populateToc();
        const savedSpread = parseInt(localStorage.getItem(STORAGE_BOOKMARK) || '0');
        if (savedSpread > 0 && savedSpread < totalSpreads()) currentSpread = savedSpread;
        renderSpread();
        setTimeout(openBookCover, 500);
      });
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

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        const anchor = getAnchorBlock();
        detectMobile();
        paginateContent();
        populateToc();
        restoreFromAnchor(anchor);
        renderSpread();
      }, 300);
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
    if (!refPage) return;

    // Read page padding from CSS (reliable — these are CSS property values, not layout geometry)
    const refStyle = getComputedStyle(refPage);
    const padH = parseFloat(refStyle.paddingLeft)  + parseFloat(refStyle.paddingRight);
    const padV = parseFloat(refStyle.paddingTop)   + parseFloat(refStyle.paddingBottom);

    // refPage.offsetWidth can be wrong on initial load: the width:100% chain through
    // .book-container → #book-frame (which has no explicit width) creates a circular
    // dependency that some browsers resolve to a tiny value before the first committed
    // layout.  Use it only when it looks plausible; otherwise derive from window.innerWidth.
    let pageWidth = refPage.offsetWidth;
    if (pageWidth < 200) {
      // .book-container { max-width:900px } inside .reader-main { padding:16px }
      // Two pages share the container, separated only by the 4px .page-spine.
      const containerW = Math.min(900, window.innerWidth - 32);
      pageWidth = isMobile ? containerW : Math.floor((containerW - 4) / 2);
    }
    const contentWidth = Math.max(150, pageWidth - padH);

    // Available vertical space: derived from viewport, not from the height:100% flex chain
    // that breaks on initial load in both Chrome and Safari.
    const hdr = document.querySelector('.reader-header');
    const ftr = document.querySelector('.reader-footer');
    const pageH = Math.max(400,
      window.innerHeight
      - (hdr ? hdr.offsetHeight : 48)
      - (ftr ? ftr.offsetHeight : 32)
      - 32  // .reader-main padding: 16px top + 16px bottom
    );

    // Measure the page-header height in isolation — a plain block element, reliable everywhere
    const hdrSizer = document.createElement('div');
    hdrSizer.className = 'page-header';
    hdrSizer.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
    hdrSizer.style.width = contentWidth + 'px';
    hdrSizer.innerHTML = '<span class="page-chapter">M</span><span class="page-num">0</span>';
    document.body.appendChild(hdrSizer);
    void hdrSizer.offsetHeight;
    const hdrH = hdrSizer.offsetHeight || 28;
    document.body.removeChild(hdrSizer);

    const maxHeight = Math.max(200, pageH - padV - hdrH);

    // Measurer: a bare .page-content div with height:auto and overflow:visible.
    // This avoids ALL flex-in-fixed-container height bugs (Chrome & Safari both fail
    // to compute clientHeight/scrollHeight correctly for flex:1/min-height:0 items
    // inside position:fixed on initial load).  With height:auto, scrollHeight equals
    // the natural content height — exactly what we want to compare against maxHeight.
    const contentEl = document.createElement('div');
    contentEl.className = 'page-content';
    contentEl.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:auto;overflow:visible;flex:none;min-height:0;';
    contentEl.style.width  = contentWidth + 'px';
    contentEl.style.fontSize = textSize + 'px';
    document.body.appendChild(contentEl);

    paginatedPages = [];
    let pageNum = 1;

    // Use a queue so split paragraph remainders can be prepended
    const queue = allBlocks.slice();

    while (queue.length > 0) {
      contentEl.innerHTML = '';
      const pageBlocks = [];

      while (queue.length > 0) {
        const block = queue[0];

        // Force a page break before a new chapter if there's already content
        if (block.type === 'chapter-start' && pageBlocks.length > 0) break;

        const el = createBlockEl(block, pageBlocks, false);
        contentEl.appendChild(el);

        if (contentEl.scrollHeight > maxHeight + 1) {
          contentEl.removeChild(el);

          if (pageBlocks.length === 0) {
            // Single block won't fit — accept it anyway to avoid infinite loop
            pageBlocks.push(block);
            queue.shift();
          } else {
            // Try to split the paragraph at a word boundary
            const split = (block.type === 'paragraph')
              ? splitParagraphForPage(block, contentEl, maxHeight, textSize)
              : null;
            if (split) {
              pageBlocks.push(split.firstBlock);
              queue[0] = split.restBlock; // remainder heads the queue for next page
            }
            // else: block stays at front of queue, starts the next page
          }
          break;
        }

        pageBlocks.push(block);
        queue.shift();
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

    document.body.removeChild(contentEl);
  }

  // Split a paragraph block so the first part fits on the current page.
  // Returns { firstBlock, restBlock } or null if no valid split exists.
  function splitParagraphForPage(block, contentEl, maxHeight, tSize) {
    const lineH = tSize * 1.6; // matches CSS line-height: 1.6
    const minH = lineH * 2;    // require at least 2 lines on each side

    // Remaining vertical space on this page
    const usedH = contentEl.scrollHeight;
    if (maxHeight - usedH < minH) return null;

    // Extract plain-text words for binary-search (inline HTML ≈ same word wrapping)
    const tmp = document.createElement('div');
    tmp.innerHTML = block.text;
    const words = (tmp.textContent || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 6) return null; // too short to be worth splitting

    // Binary search: largest N where first N words fit in remaining page space
    let lo = 2, hi = words.length - 2, bestN = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const testEl = document.createElement('p');
      if (block.isFirstInChapter) testEl.className = 'first-para-after-heading';
      testEl.textContent = words.slice(0, mid).join(' ');
      contentEl.appendChild(testEl);
      const fits = contentEl.scrollHeight <= maxHeight + 1;
      contentEl.removeChild(testEl);
      if (fits) { bestN = mid; lo = mid + 1; }
      else hi = mid - 1;
    }

    if (bestN < 2 || words.length - bestN < 4) return null;

    // Split the actual HTML at word boundary bestN
    const { firstHtml, restHtml } = splitHtmlAtWords(block.text, bestN);
    if (!restHtml) return null;

    const firstBlock = Object.assign({}, block, { text: firstHtml });
    const restBlock  = Object.assign({}, block, {
      text: restHtml,
      isFirstInChapter: false,
      isSplitContinuation: true
    });
    return { firstBlock, restBlock };
  }

  // Split HTML string after the first N words (using DOM Range for correct tag handling).
  // Returns { firstHtml, restHtml }.
  function splitHtmlAtWords(html, n) {
    const div = document.createElement('div');
    div.innerHTML = html;

    let wordCount = 0;
    let splitNode = null;
    let splitOffset = 0;

    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let node;
    outer: while ((node = walker.nextNode())) {
      const parts = node.textContent.split(/(\s+)/);
      let charPos = 0;
      for (const part of parts) {
        if (part.trim() !== '') {
          wordCount++;
          if (wordCount === n + 1) {
            splitNode = node;
            splitOffset = charPos; // offset of the (n+1)th word in this text node
            break outer;
          }
        }
        charPos += part.length;
      }
    }

    if (!splitNode) return { firstHtml: html, restHtml: '' };

    // Use Range to capture content up to the split point
    const range = document.createRange();
    range.setStart(div, 0);
    range.setEnd(splitNode, splitOffset);

    const firstDiv = document.createElement('div');
    firstDiv.appendChild(range.cloneContents());
    range.deleteContents(); // removes captured content from div

    return {
      firstHtml: firstDiv.innerHTML.trim(),
      restHtml:  div.innerHTML.trim()
    };
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
    if (!block.isSplitContinuation) p.id = 'p-' + block.chapterId + '-' + block.paraIdx;

    if (withHighlights) {
      p.innerHTML = applyHighlightsToText(block.text, block.chapterId, block.paraIdx);
    } else {
      p.innerHTML = block.text;
    }
    return p;
  }

  function detectMobile() {
    isMobile = window.innerWidth <= 768 || window.innerHeight > window.innerWidth;
  }

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
        const parsed = JSON.parse(saved);
        currentUser = { userId: parsed.userId || uuid() };
      }
    } catch (e) { /* ignore */ }
    if (!currentUser) {
      currentUser = { userId: uuid() };
      localStorage.setItem(STORAGE_USER, JSON.stringify(currentUser));
    }
  }

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
    updatePageStacks();
    localStorage.setItem(STORAGE_BOOKMARK, String(currentSpread));
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
    const hl = {
      id: uuid(), userId: currentUser.userId, userName: '',
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
    const hl = {
      id: uuid(), userId: currentUser.userId, userName: '',
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
    editingCommentId = null;
    $('#comment-level').value = level;
    $('#comment-chapter').value = chapterId || '';
    $('#comment-page').value = '';
    $('#comment-para').value = paraIdx !== undefined ? paraIdx : '';
    $('#comment-highlight-id').value = highlightId || '';
    $('#comment-text').value = '';

    const labels = { paragraph: 'Comment on Passage', page: 'Comment on Section', chapter: 'Comment on Chapter', novel: 'Comment on Novel' };
    $('#comment-modal-title').textContent = labels[level] || 'Add Comment';
    $('#comment-form').querySelector('button[type="submit"]').textContent = 'Submit Comment';
    const ctx = $('#comment-context');
    ctx.textContent = contextText ? '\u201C' + contextText + '\u201D' : '';

    const removeBtn = $('#btn-remove-highlight');
    if (highlightId) {
      removeBtn.style.display = 'block';
      removeBtn.dataset.hlId = highlightId;
    } else {
      removeBtn.style.display = 'none';
      removeBtn.dataset.hlId = '';
    }

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
      filtered.map(c => commentItemHtml(c)).join('');
  }

  function commentItemHtml(c, showHighlightContext) {
    let ctx = '';
    if (showHighlightContext && c.highlightId) {
      const hl = highlights.find(h => h.id === c.highlightId);
      if (hl) ctx = '<div class="comment-context" style="font-size:12px;margin-bottom:4px;padding:4px 8px;">\u201C' + escapeHtml(hl.text.slice(0, 80)) + (hl.text.length > 80 ? '...' : '') + '\u201D</div>';
    }
    const actions = '<span class="comment-actions">' +
      '<button class="cmt-btn cmt-edit" data-id="' + c.id + '">Edit</button>' +
      '<button class="cmt-btn cmt-delete" data-id="' + c.id + '">Delete</button>' +
      '</span>';
    return '<div class="comment-item">' + ctx +
      '<div class="comment-meta">' + new Date(c.timestamp).toLocaleDateString() + actions + '</div>' +
      '<div class="comment-body">' + escapeHtml(c.text) + '</div>' +
      '</div>';
  }

  function deleteHighlight(id) {
    highlights = highlights.filter(h => h.id !== id);
    saveHighlights();
    comments = comments.filter(c => c.highlightId !== id);
    saveComments();
    $('#comment-modal').classList.remove('visible');
    renderSpread();
    renderSidebarComments();
  }

  function deleteComment(id) {
    const cmt = comments.find(c => c.id === id);
    comments = comments.filter(c => c.id !== id);
    saveComments();
    renderSidebarComments();
    if ($('#comment-modal').classList.contains('visible') && cmt) {
      renderExistingComments(cmt.level, cmt.chapterId, cmt.paraIdx, cmt.highlightId);
    }
  }

  function startEditComment(id) {
    const cmt = comments.find(c => c.id === id);
    if (!cmt) return;
    openCommentModal(cmt.level, cmt.chapterId, cmt.paraIdx, cmt.highlightId, null);
    editingCommentId = id;
    $('#comment-text').value = cmt.text;
    $('#comment-modal-title').textContent = 'Edit Comment';
    $('#comment-form').querySelector('button[type="submit"]').textContent = 'Update Comment';
  }

  function submitComment(e) {
    e.preventDefault();
    const text = $('#comment-text').value.trim();
    if (!text) return;
    if (editingCommentId) {
      const cmt = comments.find(c => c.id === editingCommentId);
      if (cmt) { cmt.text = text; cmt.timestamp = new Date().toISOString(); }
      saveComments();
      editingCommentId = null;
    } else {
      addComment({
        id: uuid(), userId: currentUser.userId, userName: '',
        level: $('#comment-level').value, chapterId: $('#comment-chapter').value || null,
        paraIdx: $('#comment-para').value !== '' ? parseInt($('#comment-para').value) : null,
        highlightId: $('#comment-highlight-id').value || null,
        text: text, timestamp: new Date().toISOString()
      });
    }
    $('#comment-modal').classList.remove('visible');
    $('#comment-text').value = '';
    renderSidebarComments();
  }

  // ---- Book Cover ----
  function openBookCover() {
    const cover = document.getElementById('book-cover');
    if (!cover) return;
    cover.classList.add('opening');
    cover.addEventListener('animationend', function () {
      cover.classList.add('hidden');
      const bc = document.querySelector('.book-container');
      if (bc) bc.classList.remove('book-is-closed');
    }, { once: true });
  }

  // ---- Page Stacks ----
  function updatePageStacks() {
    const total = totalSpreads();
    if (total <= 1) return;
    const pct = currentSpread / (total - 1);
    const min = 4, max = 22;
    const left  = Math.round(min + pct * (max - min));
    const right = Math.round(min + (1 - pct) * (max - min));
    const sl = document.getElementById('stack-left');
    const sr = document.getElementById('stack-right');
    if (sl) sl.style.width = left + 'px';
    if (sr) sr.style.width = right + 'px';
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
    list.innerHTML = filtered.map(c => commentItemHtml(c, true)).join('');
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
    $('#close-comment-modal').addEventListener('click', () => {
      editingCommentId = null;
      $('#comment-modal').classList.remove('visible');
    });

    $('#btn-remove-highlight').addEventListener('click', () => {
      const hlId = $('#btn-remove-highlight').dataset.hlId;
      if (hlId) deleteHighlight(hlId);
    });

    $('#sidebar-comments-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.cmt-btn');
      if (!btn) return;
      if (btn.classList.contains('cmt-delete')) deleteComment(btn.dataset.id);
      else if (btn.classList.contains('cmt-edit')) startEditComment(btn.dataset.id);
    });

    $('#existing-comments').addEventListener('click', (e) => {
      const btn = e.target.closest('.cmt-btn');
      if (!btn) return;
      if (btn.classList.contains('cmt-delete')) deleteComment(btn.dataset.id);
      else if (btn.classList.contains('cmt-edit')) startEditComment(btn.dataset.id);
    });

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
