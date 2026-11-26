// The customer feedback page (public, no sign-in): /f/<token>. A star rating, two quick questions and a comment.
// A 5-star answer is asked for a website review. Only the customer's first name is shown here.
const box = document.getElementById('fb');
const token = location.pathname.split('/').filter(Boolean).pop();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const head = '<div class="fb-brand"><img src="/img/mark-green.png" alt="" width="40" height="41"><span>നല്ല മലയാളം · Nalla Malayalam</span></div>';
const api = async (method, body) => {
  const r = await fetch(`/api/public/feedback/${encodeURIComponent(token)}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app' }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
};

function thanks(d) {
  const share = `https://wa.me/?text=${encodeURIComponent(d.share_text)}`;
  const five = d.stars === 5;
  box.innerHTML = `${head}<div class="fb-stars big" aria-label="${d.stars} out of 5 stars">${'★'.repeat(d.stars)}<span class="off">${'★'.repeat(5 - d.stars)}</span></div>
    <h1>Thank you${d.first_name ? ', ' + esc(d.first_name) : ''}!</h1>
    ${five ? `<p>We're so glad you like the books. Could you do us a small favour and write a short review on our website? It helps other parents find us.</p>
      ${d.review_url || d.website_url ? `<a class="btn primary block" href="${esc(d.review_url || d.website_url)}" target="_blank" rel="noopener">Write a review on the website</a>` : ''}
      <div class="notice info">After you post it, send us a screenshot on WhatsApp and we'll send you a coupon for your next order.</div>`
      : '<p>Your answer helps us make better books. We read every one.</p>'}
    <p class="center"><a href="${esc(share)}" target="_blank" rel="noopener">Share Nalla Malayalam with friends on WhatsApp</a></p>
    ${d.can_change ? '<p class="center small"><button class="linkbtn" type="button" id="fb-edit">Change my answer</button></p>' : ''}`;
  document.getElementById('fb-edit')?.addEventListener('click', () => form(d));
}

function form(d) {
  let stars = d.stars || 0;
  const chips = (name, opts, on) => `<div class="choice" role="group">${opts.map(o => `<label><input type="checkbox" name="${name}" value="${esc(o)}" ${on.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
  box.innerHTML = `${head}<h1>How are you finding the books${d.first_name ? ', ' + esc(d.first_name) : ''}?</h1>
    <form id="fb-form" novalidate>
      <fieldset class="fb-stars" id="fb-stars"><legend class="sr-only">Your rating</legend>${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} star${n === 1 ? '' : 's'}" aria-pressed="false">★</button>`).join('')}</fieldset>
      <p class="muted small center" id="fb-tap">Tap a star</p>
      <div class="field"><span class="label">What do you like most?</span>${chips('liked', d.options.liked, d.liked)}</div>
      <div class="field"><span class="label">Why did you buy it?</span>${chips('reasons', d.options.reasons, d.reasons)}</div>
      <div class="field"><label for="fb-c">Anything else? (optional)</label><textarea id="fb-c" name="comment" rows="3" maxlength="1000">${esc(d.comment)}</textarea></div>
      <div id="fb-err" role="alert"></div>
      <button class="btn primary block" type="submit">Send</button>
      <p class="muted small center">Only Nalla Malayalam sees your answers.</p>
    </form>`;
  const f = document.getElementById('fb-form');
  const paint = () => f.querySelectorAll('[data-n]').forEach(b => { const on = Number(b.dataset.n) <= stars; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(Number(b.dataset.n) === stars)); });
  f.querySelector('#fb-stars').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (b) { stars = Number(b.dataset.n); paint(); f.querySelector('#fb-tap').textContent = ['', 'Poor', 'Not great', 'Good', 'Very good', 'Excellent'][stars]; } });
  paint();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = f.querySelector('#fb-err'); err.innerHTML = '';
    if (!stars) { err.innerHTML = '<div class="notice error">Tap a star to rate the books.</div>'; return; }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const values = name => [...f.querySelectorAll(`input[name=${name}]:checked`)].map(i => i.value);
      thanks(await api('POST', { stars, liked: values('liked'), reasons: values('reasons'), comment: f.comment.value }));
      window.scrollTo(0, 0);
    } catch (x) { err.innerHTML = `<div class="notice error">${esc(x.message)}</div>`; btn.disabled = false; }
  });
}

api('GET').then(d => (d.submitted ? thanks(d) : form(d))).catch(e => { box.innerHTML = `${head}<h1>Sorry</h1><p>${esc(e.message)}</p><p class="muted">If you got this link from Nalla Malayalam on WhatsApp, reply there and we'll help.</p>`; });
