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
  const STORAGE_BOOKMARK = window.NOVEL_FORCE_MOBILE ? 'novel_bookmark_mobile' : 'novel_bookmark';
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
  let isChromeVisible = false;
  let chromeHideTimer = null;

  // ---- Diff state ----
  let activeDiffSha     = null;
  let diffParaMap       = {};  // 'chapterId:paraIdx' → 'add' | 'modified' | 'same'
  let diffWordMap       = {};  // 'chapterId:paraIdx' → word-diff HTML
  let diffDelBefore     = {};  // 'chapterId:paraIdx' → [old para texts] injected before this para
  let diffDelAfterLast  = {};  // 'chapterId' → [old para texts] injected after chapter's last para

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ---- Init ----
  function init() {
            // Helper to re-paginate and re-render after font load/layout
            function repaginateAfterFontLoad() {
              paginateContent();
              populateToc();
              restoreFromAnchor(getAnchorBlock());
              renderSpread();
            }

        // Helper to re-paginate and re-render after font load
        function repaginateAfterFontLoad() {
          paginateContent();
          populateToc();
          restoreFromAnchor(getAnchorBlock());
          renderSpread();
        }

    buildBlockList();
    detectMobile();
    loadUser();
    loadHighlights();
    resolveHighlightPositions();
    loadComments();
    loadTextSize();
    bindEvents();

    // Wait for all fonts to load, then defer to next animation frame so the flex
    // layout is fully committed before we measure page heights and paginate.
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        // Read bookmark BEFORE repaginateAfterFontLoad — that fn calls renderSpread()
        // which overwrites localStorage with currentSpread=0, clobbering the saved position.
        const savedSpread = parseInt(localStorage.getItem(STORAGE_BOOKMARK) || '0');
        repaginateAfterFontLoad();
        const targetSpread = (savedSpread > 0 && savedSpread < totalSpreads()) ? savedSpread : 0;
        setTimeout(() => {
          openBookCover(targetSpread);
        }, 500);
      });
    });

    // Listen for all font loading events and re-paginate if needed
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', () => {
        setTimeout(() => repaginateAfterFontLoad(), 50);
      });
      document.fonts.addEventListener('loading', () => {
        setTimeout(() => repaginateAfterFontLoad(), 50);
      });
      document.fonts.addEventListener('loadingerror', () => {
        setTimeout(() => repaginateAfterFontLoad(), 50);
      });
    }

    // Re-paginate on visibility change (e.g., tab switch)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        setTimeout(() => repaginateAfterFontLoad(), 50);
      }
    });

    // Fallback: re-paginate after a short timeout on initial load (for edge cases)
    setTimeout(() => repaginateAfterFontLoad(), 2000);

    // Listen for late font loads and re-paginate if needed
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', () => {
        // Wait a frame to ensure layout is committed
        requestAnimationFrame(() => {
          repaginateAfterFontLoad();
        });
      });
    }

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

    const refStyle = getComputedStyle(refPage);
    // On mobile, hardcode padding to match .page-right { padding: 40px 28px } so we
    // never get the wrong value from getComputedStyle timing issues.
    // On mobile, hardcode padding to match .page-right { padding: 40px 28px } so we
    // never get the wrong value from getComputedStyle timing issues.
    const padH = isMobile
      ? 56 // 28px left + 28px right
      : parseFloat(refStyle.paddingLeft) + parseFloat(refStyle.paddingRight);

    // On mobile the page always fills the full viewport width — use window.innerWidth
    // directly so pagination is correct regardless of DOM layout timing.
    // On desktop, use the measured width with a sensible fallback.
    let pageWidth;
    if (isMobile) {
      pageWidth = window.innerWidth;
    } else {
      pageWidth = refPage.offsetWidth;
      if (pageWidth < 200) {
        // .book-container { max-width:900px } inside .reader-main { padding:16px }
        // Two pages share the container, separated only by the 4px .page-spine.
        const containerW = Math.min(900, window.innerWidth - 32);
        pageWidth = Math.floor((containerW - 4) / 2);
      }
    }
    const contentWidth = Math.max(150, pageWidth - padH);


    // --- Robust: Measure available height for .page-content using a hidden, styled dummy element ---
    let maxHeight;
    {
      // Create a hidden .page-content with all relevant styles
      const dummyPage = document.createElement('div');
      dummyPage.className = refPage.className;
      dummyPage.style.cssText = refPage.style.cssText + ';position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
      dummyPage.style.width = pageWidth + 'px';
      dummyPage.style.height = refPage.style.height || refPage.offsetHeight + 'px';
      // Add a header, content, and footer as in the real page
      const dummyHeader = document.createElement('div');
      dummyHeader.className = 'page-header';
      dummyHeader.style.height = '';
      dummyHeader.innerHTML = '<span class="page-chapter">M</span>';
      const dummyContent = document.createElement('div');
      dummyContent.className = 'page-content';
      dummyContent.style.fontSize = textSize + 'px';
      dummyContent.style.width = contentWidth + 'px';
      // Fill with a tall block to force max expansion
      const tall = document.createElement('div');
      tall.style.height = '10000px';
      dummyContent.appendChild(tall);
      const dummyFooter = document.createElement('div');
      dummyFooter.className = 'page-footer';
      dummyFooter.innerHTML = '';
      dummyPage.appendChild(dummyHeader);
      dummyPage.appendChild(dummyContent);
      dummyPage.appendChild(dummyFooter);
      document.body.appendChild(dummyPage);
      // Now measure the available height for .page-content
      maxHeight = dummyContent.offsetHeight;
      document.body.removeChild(dummyPage);
      // Fallback if something goes wrong
      if (!maxHeight || maxHeight < 100) {
        const hdr = document.querySelector('.reader-header');
        const ftr = document.querySelector('.reader-footer');
        const pageH = Math.max(400,
          window.innerHeight
          - (hdr ? hdr.offsetHeight : 48)
          - (ftr ? ftr.offsetHeight : 32)
          - 32
        );
        const lineH = textSize * 1.6;
        const linesPerPage = Math.floor(pageH / lineH);
        maxHeight = Math.max(lineH, linesPerPage * lineH);
      }
    }

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
              ? splitParagraphForPage(block, contentEl, maxHeight)
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
  function splitParagraphForPage(block, contentEl, maxHeight) {
    // Extract plain-text words for binary-search (inline HTML ≈ same word wrapping)
    const tmp = document.createElement('div');
    tmp.innerHTML = block.text;
    const words = (tmp.textContent || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;

    // Greedy word-by-word fill: add words one by one until height exceeds maxHeight
    let n = 1;
    let lastGoodN = 0;
    let lastHeight = null;
    while (n <= words.length) {
      const testEl = document.createElement('p');
      if (block.isFirstInChapter) testEl.className = 'first-para-after-heading';
      testEl.textContent = words.slice(0, n).join(' ');
      contentEl.appendChild(testEl);
      const h = contentEl.scrollHeight;
      contentEl.removeChild(testEl);
      if (lastHeight === null) lastHeight = h;
      if (h > maxHeight + 1) break;
      lastGoodN = n;
      lastHeight = h;
      n++;
    }

    if (lastGoodN < 1 || lastGoodN >= words.length) return null;

    // Split the actual HTML at word boundary lastGoodN
    const { firstHtml, restHtml } = splitHtmlAtWords(block.text, lastGoodN);
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
    else if (block.isSplitContinuation) p.className = 'split-continuation';
    p.setAttribute('data-chapter', block.chapterId);
    p.setAttribute('data-para', String(block.paraIdx));
    if (!block.isSplitContinuation) p.id = 'p-' + block.chapterId + '-' + block.paraIdx;

    if (activeDiffSha) {
      const key = block.chapterId + ':' + block.paraIdx;
      const dtype = diffParaMap[key];
      if (dtype === 'add') {
        p.classList.add('para-diff-add');
      } else if (dtype === 'modified') {
        p.classList.add('para-diff-modified');
        p.innerHTML = diffWordMap[key] || block.text;
        return p;
      }
    }

    if (withHighlights) {
      p.innerHTML = applyHighlightsToText(block.text, block.chapterId, block.paraIdx);
    } else {
      p.innerHTML = block.text;
    }
    return p;
  }

  function detectMobile() {
    if (window.NOVEL_FORCE_MOBILE) {
      isMobile = true;
      document.body.classList.add('mobile-reader');
      return;
    }
    if (window.NOVEL_FORCE_DESKTOP) {
      isMobile = false;
      document.body.classList.remove('mobile-reader');
      document.body.classList.remove('chrome-visible');
      isChromeVisible = false;
      return;
    }
    // Auto-detect fallback
    isMobile = window.innerWidth <= 768 || window.innerHeight > window.innerWidth;
    if (isMobile) {
      document.body.classList.add('mobile-reader');
    } else {
      document.body.classList.remove('mobile-reader');
      document.body.classList.remove('chrome-visible');
      isChromeVisible = false;
    }
  }

  // ---- Text Size ----
  function loadTextSize() {
    try {
      const saved = localStorage.getItem(STORAGE_SIZE);
      if (saved) textSize = parseInt(saved);
    } catch (e) { /* ignore */ }
    textSize = Math.max(12, Math.min(28, textSize || (window.NOVEL_FORCE_MOBILE ? 20 : 16)));
    applyTextSize();
  }

  function applyTextSize() {
    document.documentElement.style.setProperty('--reader-font-size', textSize + 'px');
  }

  function changeTextSize(delta) {
    textSize = Math.max(12, Math.min(28, textSize + delta));
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

    // Mobile: instant render + CSS slide-in, no overlay needed
    if (isMobile) {
      currentSpread = newSpread;
      renderSpread();
      const pageEl = document.getElementById('page-right');
      if (pageEl) {
        pageEl.style.animation = 'none';
        void pageEl.offsetHeight; // trigger reflow
        pageEl.style.animation = direction === 'forward'
          ? 'mobile-page-in-right 0.18s ease-out'
          : 'mobile-page-in-left 0.18s ease-out';
      }
      return;
    }

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
        '<div class="page-content">' + deptContent + '</div>' +
        '<div class="page-footer">' + pageFooterHtml(departingEl) + '</div>';
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
        '<div class="page-content">' + arrvContent + '</div>' +
        '<div class="page-footer">' + pageFooterHtml(arrivingEl) + '</div>';
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
      if (pages[0]) { renderPage(pageRight, pages[0], 'right'); pageRight.classList.remove('empty-page'); }
    } else {
      pageLeft.classList.remove('hidden-mobile');
      spine.classList.remove('hidden-mobile');
      if (pages[0]) { renderPage(pageLeft, pages[0], 'left'); pageLeft.classList.remove('empty-page'); }
      else clearPage(pageLeft);
      if (pages[1]) { renderPage(pageRight, pages[1], 'right'); pageRight.classList.remove('empty-page'); }
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
    if (isMobile) updateMobileChrome();
  }

  function updateMobileChrome() {
    const total = totalSpreads();
    const pp = pagesPerSpread();
    const pages = paginatedPages.slice(currentSpread * pp, currentSpread * pp + pp);
    const pageNum = pages[0] ? pages[0].pageNum : 1;
    const totalPages = paginatedPages.length;

    const slider = document.getElementById('mobile-progress-slider');
    const indicator = document.getElementById('mobile-page-indicator');
    if (slider) { slider.max = String(total - 1); slider.value = String(currentSpread); }
    if (indicator) { indicator.textContent = 'Page ' + pageNum + ' of ' + totalPages; }
  }

  function renderPage(el, pageData, side) {
    const hasChapterStart = pageData.blocks.some(b => b.type === 'chapter-start');
    let label = '';
    if (!hasChapterStart) {
      label = side === 'left'
        ? pageData.chapterTitle
        : (pageData.chapterSubtitle || pageData.chapterTitle);
    }
    el.querySelector('.page-chapter').textContent = label;
    el.querySelector('.page-num').textContent = pageData.pageNum;

    const content = el.querySelector('.page-content');
    content.innerHTML = '';
    for (let i = 0; i < pageData.blocks.length; i++) {
      const block = pageData.blocks[i];

      if (activeDiffSha && block.type === 'paragraph') {
        const key = block.chapterId + ':' + block.paraIdx;
        for (const delText of (diffDelBefore[key] || [])) {
          const ghost = document.createElement('p');
          ghost.className = 'para-diff-del';
          ghost.innerHTML = delText;
          content.appendChild(ghost);
        }
      }

      content.appendChild(createBlockEl(block, pageData.blocks.slice(0, i), true));

      // After last para of a chapter, inject any trailing deletions
      if (activeDiffSha && block.type === 'paragraph') {
        const nextBlock = pageData.blocks[i + 1];
        const chapterEndsOnPage = !nextBlock || nextBlock.chapterId !== block.chapterId;
        if (chapterEndsOnPage) {
          for (const delText of (diffDelAfterLast[block.chapterId] || [])) {
            const ghost = document.createElement('p');
            ghost.className = 'para-diff-del';
            ghost.innerHTML = delText;
            content.appendChild(ghost);
          }
        }
      }
    }
  }

  function clearPage(el) {
    el.querySelector('.page-chapter').textContent = '';
    el.querySelector('.page-num').textContent = '';
    el.querySelector('.page-content').innerHTML = '';
    el.classList.add('empty-page');
  }

  function pageFooterHtml(el) {
    const f = el.querySelector('.page-footer');
    return f ? f.innerHTML : '';
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
  function openBookCover(targetSpread) {
    const cover = document.getElementById('book-cover');
    if (!cover) return;

    if (isMobile) {
      const bc = document.querySelector('.book-container');
      if (bc) bc.classList.remove('book-is-closed');
      // Start at spread 0 so the slide animation has somewhere to begin
      currentSpread = 0;
      renderSpread();
      // Show cover briefly, then fade it out; then slide to the bookmark
      setTimeout(() => {
        cover.style.transition = 'opacity 0.3s ease';
        cover.style.opacity = '0';
        cover.addEventListener('transitionend', () => {
          if (cover.parentNode) cover.parentNode.removeChild(cover);
          if (targetSpread > 0) setTimeout(() => animateToBookmark(targetSpread), 200);
        }, { once: true });
      }, 500);
      return;
    }

    // Desktop: 3D cover-open animation
    cover.classList.add('opening');
    cover.addEventListener('animationend', function () {
      cover.classList.add('hidden');
      cover.classList.remove('opening');
      const bc = document.querySelector('.book-container');
      if (bc) bc.classList.remove('book-is-closed');
      setTimeout(() => {
        if (cover.parentNode) cover.parentNode.removeChild(cover);
      }, 100);
      if (targetSpread > 0) {
        setTimeout(() => animateToBookmark(targetSpread), 350);
      }
    }, { once: true });
  }

  // ---- Mobile Chrome Toggle ----
  function showChrome() {
    isChromeVisible = true;
    document.body.classList.add('chrome-visible');
    clearTimeout(chromeHideTimer);
    chromeHideTimer = setTimeout(hideChrome, 3000);
  }
  function hideChrome() {
    isChromeVisible = false;
    document.body.classList.remove('chrome-visible');
    clearTimeout(chromeHideTimer);
  }
  function toggleChrome() {
    if (isChromeVisible) hideChrome(); else showChrome();
  }

  // ---- Physical Bookmark ----
  // Inserts the bookmark ribbon onto .book-container for the final landing spread.
  function insertBookmark() {
    const existing = document.querySelector('.page-bookmark');
    if (existing) existing.remove();
    const bm = document.createElement('div');
    bm.className = isMobile
      ? 'page-bookmark page-bookmark-mobile'
      : 'page-bookmark page-bookmark-desktop';
    const container = document.querySelector('.book-container');
    if (container) container.appendChild(bm);
  }

  // Triggers the slide-out animation and removes the bookmark when done.
  function releaseBookmark() {
    const bm = document.querySelector('.page-bookmark');
    if (!bm) return;
    bm.classList.add('bookmark-sliding-out');
    bm.addEventListener('animationend', () => bm.remove(), { once: true });
  }

  // Animate from the current spread to targetSpread, simulating rapidly turning pages.
  // Uses exponential decay so steps slow down as they approach the bookmark.
  // Desktop: 3-D page-flip overlay. Mobile: CSS slide animation.
  function animateToBookmark(targetSpread) {
    if (targetSpread <= 0 || targetSpread >= totalSpreads()) return;

    isAnimating = true;

    const MAX_SHOWN = isMobile ? 5  : 3;   // max individually animated steps
    const FIRST_MS  = isMobile ? 80  : 120; // duration of first (fastest) step
    const LAST_MS   = isMobile ? 320 : 340; // duration of last (slowest) step

    // Silently jump most of the way for large distances
    if (targetSpread > MAX_SHOWN) {
      currentSpread = targetSpread - MAX_SHOWN;
      renderSpread();
    }

    const steps = Math.min(targetSpread, MAX_SHOWN);
    let remaining = steps;

    // Exponential interpolation: pos 0 → FIRST_MS, pos (steps-1) → LAST_MS
    function stepDuration(pos) {
      return steps > 1
        ? Math.round(FIRST_MS * Math.pow(LAST_MS / FIRST_MS, pos / (steps - 1)))
        : LAST_MS;
    }

    function doStep() {
      if (remaining <= 0) { isAnimating = false; return; }
      remaining--;
      const pos = steps - 1 - remaining; // 0 = first/fastest, steps-1 = last/slowest
      const duration = stepDuration(pos);
      const isLastStep = remaining === 0;

      if (isMobile) {
        // Mobile: "deal card" — snapshot old page, render new one underneath, slide old off left
        const pr = document.getElementById('page-right');
        const deptHeader  = pr ? pr.querySelector('.page-header').innerHTML : '';
        const deptContent = pr ? pr.querySelector('.page-content').innerHTML : '';
        const deptFooter  = pr ? pageFooterHtml(pr) : '';

        currentSpread++;
        renderSpread();
        if (isLastStep) insertBookmark();

        const dealOverlay = document.createElement('div');
        dealOverlay.className = 'mobile-deal-overlay';
        dealOverlay.style.animation = 'mobile-deal-left ' + duration + 'ms ease-in forwards';
        dealOverlay.innerHTML =
          '<div class="page-header">' + deptHeader + '</div>' +
          '<div class="page-content">' + deptContent + '</div>' +
          '<div class="page-footer">' + deptFooter + '</div>';
        const frame = document.getElementById('book-frame');
        if (frame) frame.appendChild(dealOverlay);

        setTimeout(() => {
          dealOverlay.remove();
          if (remaining > 0) doStep();
          else { isAnimating = false; setTimeout(releaseBookmark, 500); }
        }, duration + 25);
      } else {
        // Desktop: 3-D flip overlay
        const container = $('.book-container');
        const overlay = document.createElement('div');
        overlay.className = 'page-flip-overlay flip-forward';
        overlay.style.animationDuration = duration + 'ms';

        // Front face: snapshot of the departing right page
        const rp = $('#page-right');
        const front = document.createElement('div');
        front.className = 'flip-face flip-front';
        front.innerHTML =
          '<div class="page-header">' + rp.querySelector('.page-header').innerHTML + '</div>' +
          '<div class="page-content">' + rp.querySelector('.page-content').innerHTML + '</div>' +
          '<div class="page-footer">' + pageFooterHtml(rp) + '</div>';
        overlay.appendChild(front);

        container.appendChild(overlay);
        currentSpread++;
        renderSpread();
        if (isLastStep) insertBookmark();

        // Back face: snapshot of the arriving left page
        const lp = $('#page-left');
        const back = document.createElement('div');
        back.className = 'flip-face flip-back';
        back.innerHTML =
          '<div class="page-header">' + lp.querySelector('.page-header').innerHTML + '</div>' +
          '<div class="page-content">' + lp.querySelector('.page-content').innerHTML + '</div>' +
          '<div class="page-footer">' + pageFooterHtml(lp) + '</div>';
        overlay.appendChild(back);

        overlay.addEventListener('animationend', function () {
          overlay.remove();
          if (remaining > 0) setTimeout(doStep, 25);
          else { isAnimating = false; setTimeout(releaseBookmark, 500); }
        }, { once: true });
      }
    }

    doStep();
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
  function toggleDiffPicker() {
    const picker = $('#diff-picker');
    const isOpening = !picker.classList.contains('open');
    if (isOpening) populateDiffPicker();
    picker.classList.toggle('open', isOpening);
  }

  function populateDiffPicker() {
    const picker = $('#diff-picker');
    picker.innerHTML = '';
    const versions = (NOVEL_DATA.versions || []).slice(1);
    if (versions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'diff-picker-item diff-picker-empty';
      empty.textContent = 'No saved versions';
      picker.appendChild(empty);
      return;
    }
    for (const v of versions) {
      const btn = document.createElement('button');
      btn.className = 'diff-picker-item' + (activeDiffSha === v.sha ? ' active' : '');
      btn.dataset.sha = v.sha;
      btn.textContent = v.label + ' \u2014 ' + v.date;
      btn.addEventListener('click', function () {
        activateDiff(v.sha);
        picker.classList.remove('open');
      });
      picker.appendChild(btn);
    }
  }

  function activateDiff(sha) {
    if (activeDiffSha === sha) {
      deactivateDiff();
      return;
    }
    const rawUrl = 'https://raw.githubusercontent.com/' + NOVEL_DATA.repo + '/' + sha + '/assets/novel/novel.md';
    fetch(rawUrl)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        activeDiffSha = sha;
        buildDiffMaps(window.parseNovelMarkdown(text), NOVEL_DATA.chapters);
        $('#btn-diff').classList.add('diff-active');
        renderSpread();
      })
      .catch(function (err) { console.error('Diff load error:', err.message); });
  }

  function deactivateDiff() {
    activeDiffSha = null;
    diffParaMap = {};
    diffWordMap = {};
    diffDelBefore = {};
    diffDelAfterLast = {};
    $('#btn-diff').classList.remove('diff-active');
    renderSpread();
  }

  function buildDiffMaps(oldChapters, newChapters) {
    diffParaMap = {};
    diffWordMap = {};
    diffDelBefore = {};
    diffDelAfterLast = {};

    for (const newCh of newChapters) {
      const oldCh = oldChapters.find(function (c) { return c.id === newCh.id; });
      const oldParas = oldCh ? oldCh.paragraphs : [];
      const newParas = newCh.paragraphs;

      if (oldParas.length === 0) {
        for (let j = 0; j < newParas.length; j++) diffParaMap[newCh.id + ':' + j] = 'add';
        continue;
      }

      const ops = computeDiff(oldParas, newParas);
      let newIdx = 0;
      let pendingDels = [];
      let i = 0;

      while (i < ops.length) {
        if (ops[i].type === 'same') {
          const key = newCh.id + ':' + newIdx;
          if (pendingDels.length > 0) { diffDelBefore[key] = pendingDels; pendingDels = []; }
          diffParaMap[key] = 'same';
          newIdx++; i++;
        } else {
          // Collect a contiguous run of del/add ops
          const dels = [], adds = [];
          while (i < ops.length && ops[i].type !== 'same') {
            if (ops[i].type === 'del') dels.push(ops[i].text);
            else adds.push(ops[i].text);
            i++;
          }
          const pairCount = Math.min(dels.length, adds.length);
          // Excess dels (no paired add) accumulate as pending
          for (let d = pairCount; d < dels.length; d++) pendingDels.push(dels[d]);
          // Paired del+add → modified with word-level diff
          for (let p = 0; p < pairCount; p++) {
            const key = newCh.id + ':' + newIdx;
            if (pendingDels.length > 0) { diffDelBefore[key] = pendingDels; pendingDels = []; }
            diffParaMap[key] = 'modified';
            diffWordMap[key] = buildWordDiff(dels[p], adds[p]);
            newIdx++;
          }
          // Pure adds (no paired del)
          for (let a = pairCount; a < adds.length; a++) {
            const key = newCh.id + ':' + newIdx;
            if (pendingDels.length > 0) { diffDelBefore[key] = pendingDels; pendingDels = []; }
            diffParaMap[key] = 'add';
            newIdx++;
          }
        }
      }
      if (pendingDels.length > 0) diffDelAfterLast[newCh.id] = pendingDels;
    }
  }

  function buildWordDiff(oldText, newText) {
    function toPlain(html) {
      const d = document.createElement('div');
      d.innerHTML = html;
      return d.textContent;
    }
    const oldTokens = toPlain(oldText).split(/(\s+)/);
    const newTokens = toPlain(newText).split(/(\s+)/);
    const ops = computeDiff(oldTokens, newTokens);
    return ops.map(function (op) {
      const t = escapeHtml(op.text);
      if (op.type === 'add') return '<mark class="diff-word-add">' + t + '</mark>';
      if (op.type === 'del') return '<del class="diff-word-del">' + t + '</del>';
      return t;
    }).join('');
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

    // Progress bar — click to jump to position
    $('.progress-bar-track').addEventListener('click', (e) => {
      const track = e.currentTarget;
      const pct = e.offsetX / track.offsetWidth;
      goToSpread(Math.round(pct * (totalSpreads() - 1)));
    });

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

    // Diff picker
    $('#btn-diff').addEventListener('click', function (e) { e.stopPropagation(); toggleDiffPicker(); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.diff-picker-wrapper')) $('#diff-picker').classList.remove('open');
    });

    // Background picker (desktop only)
    initBackgroundPicker();

    // Close modals on backdrop
    $$('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => { if (e.target === modal && modal.id !== 'auth-modal') modal.classList.remove('visible'); });
    });

    // Mobile tap zones + swipe
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    const mainEl = $('.reader-main');
    mainEl.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    mainEl.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dt = Date.now() - touchStartTime;

      // Swipe: >60px horizontal, <40px vertical, <400ms
      if (Math.abs(dx) > 60 && Math.abs(dy) < 40 && dt < 400) {
        if (dx > 0) goToSpread(currentSpread - 1); else goToSpread(currentSpread + 1);
        return;
      }

      // Tap: barely moved, quick — mobile only
      if (isMobile && Math.abs(dx) < 15 && Math.abs(dy) < 15 && dt < 300) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return; // text selected — don't navigate
        const x = e.changedTouches[0].clientX;
        const w = window.innerWidth;
        if (x < w * 0.30) goToSpread(currentSpread - 1);
        else if (x > w * 0.70) goToSpread(currentSpread + 1);
        else toggleChrome();
      }
    }, { passive: true });

    // Mobile progress slider
    const mobileSlider = document.getElementById('mobile-progress-slider');
    if (mobileSlider) {
      mobileSlider.addEventListener('input', () => {
        const target = parseInt(mobileSlider.value, 10);
        if (!isNaN(target)) {
          currentSpread = Math.max(0, Math.min(target, totalSpreads() - 1));
          renderSpread();
        }
      });
    }
  }

  // ---- Background Picker ----
  function applyBackground(url) {
    if (url) {
      document.body.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundPosition = '';
      document.body.style.backgroundAttachment = '';
    }
  }

  function initBackgroundPicker() {
    const bgBtn  = document.getElementById('btn-bg');
    const picker = document.getElementById('bg-picker');
    const bgs    = window.NOVEL_BACKGROUNDS;
    if (!bgBtn || !picker || !bgs || !bgs.length) return;

    // Build item list
    bgs.forEach(bg => {
      const item = document.createElement('button');
      item.className = 'bg-picker-item';
      item.dataset.url = bg.url;
      item.textContent = bg.name;
      picker.appendChild(item);
    });

    // Restore saved selection
    const saved = localStorage.getItem('novel_background');
    if (saved) {
      applyBackground(saved);
      const match = picker.querySelector('[data-url="' + saved + '"]');
      if (match) match.classList.add('active');
    }

    // Toggle picker open/closed
    bgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.classList.toggle('open');
    });

    // Select / deselect a background
    picker.addEventListener('click', (e) => {
      const item = e.target.closest('.bg-picker-item');
      if (!item) return;
      const url      = item.dataset.url;
      const wasActive = item.classList.contains('active');
      picker.querySelectorAll('.bg-picker-item').forEach(i => i.classList.remove('active'));
      if (wasActive) {
        applyBackground(null);
        localStorage.removeItem('novel_background');
      } else {
        item.classList.add('active');
        applyBackground(url);
        localStorage.setItem('novel_background', url);
      }
      picker.classList.remove('open');
    });

    // Close on outside click
    document.addEventListener('click', () => picker.classList.remove('open'));
  }

  // ---- Go ----
  // Wait for md-parser.js to fetch and populate NOVEL_DATA
  document.addEventListener('novel-data-ready', init);
})();
