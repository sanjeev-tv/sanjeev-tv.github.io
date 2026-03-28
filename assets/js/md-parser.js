// ============================================================
//  Markdown Parser — loads novel.md and populates NOVEL_DATA
//  Edit assets/novel/novel.md to update the novel content.
// ============================================================

(function () {
  // Metadata not in the markdown itself
  const META = {
    title: "In the Emperor's Shadow",
    author: "Sanjeev Venkatesan",
    repo: "sanjeev-tv/sanjeev-tv.github.io"
  };

  // Slugify a chapter heading like "Chapter 1" → "chapter-1", "Prologue" → "prologue"
  function slugify(title) {
    return title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Convert basic inline markdown to HTML
  function inlineMarkdown(text) {
    // Bold-italic: ***text*** or ___text___
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    // Bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    text = text.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+?)_/g, '<em>$1</em>');
    return text;
  }

  function parseMarkdown(text) {
    const lines = text.split('\n');
    const chapters = [];
    let currentChapter = null;
    let currentPara = [];

    function flushParagraph() {
      if (!currentChapter || currentPara.length === 0) { currentPara = []; return; }
      const paraText = currentPara.join(' ').trim();
      if (paraText) {
        currentChapter.paragraphs.push(inlineMarkdown(paraText));
      }
      currentPara = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      if (line.startsWith('# ')) {
        // New chapter heading — flush previous paragraph and chapter
        flushParagraph();
        const title = line.slice(2).trim();
        currentChapter = {
          id: slugify(title),
          title: title,
          subtitle: '',
          paragraphs: []
        };
        chapters.push(currentChapter);
      } else if (line.startsWith('## ')) {
        // Chapter subtitle
        flushParagraph();
        if (currentChapter) {
          currentChapter.subtitle = line.slice(3).trim();
        }
      } else if (line === '') {
        // Blank line — paragraph break
        flushParagraph();
      } else {
        // Regular text — accumulate into paragraph
        if (currentChapter) {
          currentPara.push(line);
        }
      }
    }
    // Flush any remaining paragraph
    flushParagraph();

    return chapters;
  }

  // Expose parser so novel-reader can re-parse historical versions for diff
  window.parseNovelMarkdown = parseMarkdown;

  // Resolve asset URLs relative to this script's src (handles Jekyll baseurl)
  function getBaseUrl() {
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      const m = s.src.match(/^(.*?)\/assets\/js\/md-parser\.js/);
      if (m) return m[1];
    }
    return '';
  }

  const base = getBaseUrl();

  Promise.all([
    fetch(base + '/assets/novel/novel.md').then(function (r) {
      if (!r.ok) throw new Error('Failed to load novel.md: ' + r.status);
      return r.text();
    }),
    fetch(base + '/assets/novel/versions.json').then(function (r) {
      return r.ok ? r.json() : { versions: [] };
    }).catch(function () { return { versions: [] }; })
  ])
    .then(function (results) {
      const text = results[0];
      const versionsData = results[1];
      const chapters = parseMarkdown(text);
      window.NOVEL_DATA = Object.assign({}, META, {
        chapters: chapters,
        versions: versionsData.versions || []
      });
      document.dispatchEvent(new CustomEvent('novel-data-ready'));
    })
    .catch(function (err) {
      console.error('[md-parser]', err);
      const content = document.querySelector('.page-content');
      if (content) content.innerHTML = '<p style="color:#c44;font-family:sans-serif">Error loading novel: ' + err.message + '</p>';
    });
})();
