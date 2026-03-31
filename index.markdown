---
layout: default
---

<style>
.home-section {
  max-width: 680px;
  margin: 48px auto;
  padding: 0 20px;
}
.home-section h2 {
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8b8580;
  margin-bottom: 24px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e0dcd4;
}
.novel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.novel-card h3 {
  font-family: 'Georgia', serif;
  font-size: 1.55em;
  font-style: italic;
  letter-spacing: 0.01em;
  color: #2c2420;
  margin: 0;
}
.novel-card .novel-byline {
  font-size: 0.875em;
  color: #8b8580;
  margin: 0;
}
.novel-card .novel-blurb {
  font-size: 0.95em;
  line-height: 1.7;
  color: #4a4440;
  font-style: italic;
  margin: 4px 0 8px;
}
.novel-card .read-btn {
  align-self: flex-start;
  background: #8b6914;
  color: #fff;
  padding: 10px 28px;
  border-radius: 4px;
  text-decoration: none;
  font-size: 0.9em;
  font-weight: 500;
  letter-spacing: 0.03em;
  transition: background 0.2s;
}
.novel-card .read-btn:hover {
  background: #a47d1a;
  text-decoration: none;
  color: #fff;
}
</style>

<section class="home-section">
  <h2>Writing</h2>
  <div class="novel-card">
    <h3>The Shattered Blade</h3>
    <p class="novel-byline">by Sanjeev Venkatesan</p>
    <p class="novel-blurb">{% include back-of-book.html %}</p>
    <a href="/novel.html" class="read-btn">Read Now</a>
  </div>
</section>
