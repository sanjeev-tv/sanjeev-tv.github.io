---
layout: default
title: The Shattered Blade
permalink: /the-shattered-blade/
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet">

<style>
.site-nav { display: none !important; }

.novel-page {
  max-width: 680px;
  margin: 48px auto;
  padding: 0 20px;
  font-family: 'Cormorant Garamond', Georgia, serif;
}
.novel-page h1 {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 2.4em;
  font-style: italic;
  letter-spacing: 0.01em;
  color: #2c2420;
  margin: 0 0 6px;
}
.novel-page .novel-byline {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1em;
  color: #8b8580;
  margin: 0 0 28px;
}
.novel-page .novel-blurb {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.15em;
  line-height: 1.75;
  color: #4a4440;
  margin: 0;
}
.novel-page .novel-blurb p {
  margin: 0 0 1.1em;
}
.novel-page .novel-blurb p:last-child {
  margin-bottom: 0;
}
.novel-page .novel-blurb .blurb-hook {
  font-variant: small-caps;
  font-weight: 700;
  color: #1c3d6e;
  font-size: 1.15em;
  letter-spacing: 0.05em;
}

/* Read now section */
.read-now-label {
  display: block;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 0.82em;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #a09890;
  margin-bottom: 10px;
}
.read-options {
  margin: 0 0 28px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.read-btn {
  background: #1c3d6e;
  color: #fff !important;
  padding: 9px 18px;
  border-radius: 4px;
  text-decoration: none;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.05em;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: background 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1.5px solid #1c3d6e;
}
.read-btn:hover {
  background: #25508f;
  border-color: #25508f;
  text-decoration: none;
  color: #fff !important;
}
.read-btn svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.read-options-divider {
  width: 1px;
  height: 28px;
  background: #d8d0c8;
  margin: 0 4px;
}
.subscribe-toggle-btn {
  background: transparent;
  color: #1c3d6e;
  border: 1.5px solid #1c3d6e;
  padding: 9px 18px;
  border-radius: 4px;
  cursor: pointer;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.05em;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: background 0.2s, color 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.subscribe-toggle-btn:hover,
.subscribe-toggle-btn.active {
  background: #1c3d6e;
  color: #fff;
}
.subscribe-toggle-btn svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

/* Subscribe panel */
.subscribe-panel {
  display: none;
  margin: -16px 0 28px;
  padding: 18px 22px 20px;
  border: 1px solid #ddd8d2;
  border-radius: 6px;
  background: #faf9f7;
}
.subscribe-panel.open {
  display: block;
}
.subscribe-panel p {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.08em;
  line-height: 1.65;
  color: #4a4440;
  margin: 0 0 14px;
}
.subscribe-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.subscribe-form input[type="email"] {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1.5px solid #c8c0b8;
  border-radius: 4px;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.05em;
  color: #2c2420;
  background: #fff;
  outline: none;
}
.subscribe-form input[type="email"]:focus {
  border-color: #1c3d6e;
}
.subscribe-form button[type="submit"] {
  background: #1c3d6e;
  color: #fff;
  border: none;
  padding: 8px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.05em;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: background 0.2s;
  white-space: nowrap;
}
.subscribe-form button[type="submit"]:hover {
  background: #25508f;
}
.subscribe-form button[type="submit"]:disabled {
  opacity: 0.6;
  cursor: default;
}
.subscribe-message {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1em;
  margin-top: 10px;
  min-height: 1.4em;
}
.subscribe-message.success { color: #2a6e38; }
.subscribe-message.error   { color: #b0392b; }
</style>

<div class="novel-page">
  <h1>The Shattered Blade</h1>
  <p class="novel-byline">by Sanjeev Venkatesan</p>

  <span class="read-now-label">Read now</span>
  <div class="read-options">
    <a href="/novel-mobile.html" class="read-btn" title="Read on Mobile">
      <!-- Phone icon -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none"/>
      </svg>
      Mobile
    </a>
    <a href="/novel.html" class="read-btn" title="Read on Desktop">
      <!-- Laptop icon -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="13" rx="2"/>
        <path d="M1 20h22"/>
      </svg>
      Desktop
    </a>
    <div class="read-options-divider"></div>
    <button class="subscribe-toggle-btn" id="subscribe-toggle">
      <!-- Envelope icon -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M2 7l10 7 10-7"/>
      </svg>
      Get updates
    </button>
  </div>

  <div class="subscribe-panel" id="subscribe-panel">
    <p>You can expect a new chapter every Sunday night. Or, enter your email below to receive notifications for updates!</p>
    <form class="subscribe-form" id="subscribe-form">
      <input type="email" id="subscriber-email" placeholder="your@email.com" required>
      <button type="submit" id="subscribe-submit">Subscribe</button>
    </form>
    <div class="subscribe-message" id="subscribe-message"></div>
  </div>

  <div class="novel-blurb">{% include back-of-book.html %}</div>
</div>

<script>
// ─── BUTTONDOWN SETUP ────────────────────────────────────────────────────────
// After creating your Buttondown account, paste your username below.
// Your username is visible at: buttondown.email/settings/basics
// ─────────────────────────────────────────────────────────────────────────────
var BUTTONDOWN_USERNAME = 'sanjeev-tv';

document.getElementById('subscribe-toggle').addEventListener('click', function () {
  var panel = document.getElementById('subscribe-panel');
  var isOpen = panel.classList.toggle('open');
  this.classList.toggle('active', isOpen);
  if (isOpen) {
    setTimeout(function () {
      document.getElementById('subscriber-email').focus();
    }, 50);
  }
});

document.getElementById('subscribe-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var email     = document.getElementById('subscriber-email').value.trim();
  var msgEl     = document.getElementById('subscribe-message');
  var submitBtn = document.getElementById('subscribe-submit');

  if (!BUTTONDOWN_USERNAME) {
    msgEl.textContent = 'Subscription not configured yet — check back soon!';
    msgEl.className = 'subscribe-message error';
    return;
  }

  submitBtn.disabled = true;
  msgEl.textContent = '';
  msgEl.className = 'subscribe-message';

  fetch('https://buttondown.email/api/emails/embed-subscribe/' + BUTTONDOWN_USERNAME, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email })
  })
  .then(function (res) {
    submitBtn.disabled = false;
    if (res.status === 201) {
      msgEl.textContent = "You're in! See you Sunday night.";
      msgEl.className = 'subscribe-message success';
      document.getElementById('subscriber-email').value = '';
    } else {
      return res.json().then(function (data) {
        var msg = (data.email && data.email[0]) || 'Something went wrong — please try again.';
        msgEl.textContent = msg;
        msgEl.className = 'subscribe-message error';
      });
    }
  })
  .catch(function () {
    submitBtn.disabled = false;
    msgEl.textContent = 'Network error — please try again.';
    msgEl.className = 'subscribe-message error';
  });
});
</script>
