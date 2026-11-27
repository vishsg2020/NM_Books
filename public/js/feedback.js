// The customer feedback page (public, no sign-in): /f/<token>. Four looks, chosen in Settings → General → Feedback page:
//   A simple page · C WhatsApp-style chat · E postcard · F "your child's story" (C and F also ask about the child).
// Malayalam first, with an English switch. After sending: a thank-you with the website review button and Done.
// Leaving without writing a website review (Done, or the phone's Back button) asks — for 4 or 5 stars with a comment —
// "may we show this on our website?". The answer can be changed from this link at any time.
const box = document.getElementById('fb');
const token = location.pathname.split('/').filter(Boolean).pop();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const logo = (size, white) => `<img src="/img/mark-${white ? 'white' : 'green'}.png" alt="" width="${size}" height="${Math.round(size * 1.03)}">`;

// ---------- Words ----------
const TXT = {
  ml: {
    brand: 'നല്ല മലയാളം', other: 'English', how: n => `പുസ്തകങ്ങൾ എങ്ങനെയുണ്ട്${n ? ', ' + n : ''}?`, tap: 'ഒരു നക്ഷത്രത്തിൽ തൊടുക',
    stars: ['', 'മോശം', 'കുഴപ്പമില്ല', 'നല്ലത്', 'വളരെ നല്ലത്', 'ഗംഭീരം'],
    liked_q: 'ഏറ്റവും ഇഷ്ടപ്പെട്ടത്?', reasons_q: 'എന്തിനാണ് വാങ്ങിയത്?', changes_q: 'കുട്ടിയിൽ എന്ത് മാറ്റം കണ്ടു?', age_q: 'കുട്ടിയുടെ പ്രായം',
    comment_q: 'കുറച്ചു വാക്കുകളിൽ പറയാമോ?', optional: '(നിർബന്ധമില്ല)', many: 'ഒന്നോ അതിലധികമോ', send: 'അയയ്ക്കുക',
    private: 'നിങ്ങളുടെ ഉത്തരം Nalla Malayalam മാത്രമേ കാണൂ.', err_star: 'ഒരു നക്ഷത്രത്തിൽ തൊട്ട് റേറ്റിംഗ് തരൂ.',
    thanks: n => `നന്ദി${n ? ', ' + n : ''}!`, got: 'നിങ്ങളുടെ അഭിപ്രായം കിട്ടി.', low: 'നിങ്ങളുടെ ഉത്തരം കൂടുതൽ നല്ല പുസ്തകങ്ങൾ ഉണ്ടാക്കാൻ സഹായിക്കും. ഓരോന്നും ഞങ്ങൾ വായിക്കും.',
    favour: 'ഒരു ചെറിയ സഹായം കൂടി?', favour_text: 'വെബ്സൈറ്റിൽ ഒരു റിവ്യൂ എഴുതി സ്ക്രീൻഷോട്ട് WhatsApp-ൽ അയച്ചാൽ അടുത്ത ഓർഡറിന് ഒരു കൂപ്പൺ തരാം.',
    write_review: 'വെബ്സൈറ്റിൽ റിവ്യൂ എഴുതുക', share: 'കൂട്ടുകാരുമായി WhatsApp-ൽ പങ്കിടുക', done: 'പൂർത്തിയായി', change: 'ഉത്തരം മാറ്റുക', change_days: '(7 ദിവസം വരെ)',
    ask: 'നിങ്ങളുടെ അഭിപ്രായം ഞങ്ങളുടെ വെബ്സൈറ്റിൽ കാണിക്കട്ടെ?', ask_help: 'മറ്റു രക്ഷിതാക്കൾക്ക് ഇത് വലിയ സഹായമാകും.',
    ask_privacy: 'പേരിന്റെ ആദ്യഭാഗവും സ്ഥലവും മാത്രം. ഫോൺ നമ്പർ കാണിക്കില്ല.', yes: 'ശരി, കാണിച്ചോളൂ', no: 'വേണ്ട, നന്ദി',
    ask_E: 'വായനക്കാരുടെ ചുമരിൽ പിൻ ചെയ്യട്ടെ?', ask_E_sub: 'nallamalayalam.in-ൽ മറ്റു രക്ഷിതാക്കളുടെ കാർഡുകൾക്കൊപ്പം', yes_E: '📌 പിൻ ചെയ്യൂ',
    ask_F: 'നിങ്ങളുടെ കാർഡ് വെബ്സൈറ്റിൽ ഇടട്ടെ?', ask_F_sub: 'കുട്ടികൾക്ക് പുസ്തകം തേടുന്ന മറ്റു രക്ഷിതാക്കൾക്ക് ഇത് വലിയ സഹായമാകും.', yes_F: 'ശരി, ഇട്ടോളൂ',
    parents_say: 'രക്ഷിതാക്കൾ പറയുന്നത്', any_time: 'എപ്പോൾ വേണമെങ്കിലും ഈ ലിങ്കിൽ നിന്ന് മാറ്റാം.',
    after_yes: 'നന്ദി! ഒന്ന് പരിശോധിച്ച ശേഷം വെബ്സൈറ്റിൽ ചേർക്കും.', after_no: 'ശരി, നിങ്ങളുടെ ഉത്തരം ഞങ്ങൾ മാത്രമേ കാണൂ.',
    remove: 'വെബ്സൈറ്റിൽ നിന്ന് മാറ്റുക', show_it: 'വെബ്സൈറ്റിൽ കാണിച്ചോളൂ', close_now: 'ഇനി ഈ പേജ് അടയ്ക്കാം.',
    age_line: a => `${a} വയസ്സുള്ള കുട്ടിയുടെ രക്ഷിതാവ്`, skip: 'ഒഴിവാക്കുക', next: 'അടുത്തത് →', your_card: 'നിങ്ങളുടെ കാർഡ്', card_ph: 'എന്റെ കുട്ടി…',
    f1: 'പുസ്തകങ്ങൾ എങ്ങനെയുണ്ട്?', f3: 'എന്താണ് ഇഷ്ടപ്പെട്ടത്? എന്തിനാണ് വാങ്ങിയത്?', f4: 'ഒരു വാക്യത്തിൽ പറയാമോ?', starters_hint: 'ഇങ്ങനെ തുടങ്ങാം:',
    starters: ['എന്റെ കുട്ടി ', 'ഏറ്റവും ഇഷ്ടം ', 'മറ്റു രക്ഷിതാക്കളോട്: '], mic: '🎤 ടൈപ്പ് ചെയ്യാൻ ബുദ്ധിമുട്ടാണോ? കീബോർഡിലെ മൈക്ക് ഉപയോഗിച്ച് പറയാം.',
    postcard: n => `${n ? n + ', ' : ''}ഞങ്ങൾക്കൊരു പോസ്റ്റ്കാർഡ് എഴുതാമോ?`, dear: 'പ്രിയ നല്ല മലയാളം,', stamp: 'സ്റ്റാമ്പ് തിരഞ്ഞെടുക്കൂ', post: '✉ പോസ്റ്റ് ചെയ്യുക',
    card_got: 'നിങ്ങളുടെ കാർഡ് ഞങ്ങൾക്ക് കിട്ടി.', received: 'കിട്ടി ✓', write_here: 'ഇവിടെ എഴുതൂ…',
    chat_sub: 'ഏകദേശം ഒരു മിനിറ്റ്', hello: n => `നമസ്കാരം${n ? ' ' + n : ''} 👋 പുസ്തകങ്ങൾ എങ്ങനെയുണ്ട്? ഒരു നക്ഷത്രത്തിൽ തൊട്ടാൽ മതി.`,
    good: 'സന്തോഷം! 😊', sorry: 'ക്ഷമിക്കണം 🙏 ഞങ്ങൾ മെച്ചപ്പെടാം.', c_liked: 'ഏറ്റവും ഇഷ്ടപ്പെട്ടത് എന്താണ്?', c_age: 'കുട്ടിയുടെ പ്രായം?',
    c_comment: 'അവസാനമായി, കുറച്ചു വാക്കുകളിൽ പറയാമോ?', c_thanks: n => `നന്ദി${n ? ' ' + n : ''}! 🙏 ഇത് വായിച്ചപ്പോൾ വലിയ സന്തോഷം.`,
    c_ask: 'ഒരു കാര്യം ചോദിച്ചോട്ടെ? ഈ വാക്കുകൾ ഞങ്ങളുടെ വെബ്സൈറ്റിൽ ഇങ്ങനെ കാണിക്കട്ടെ?', pick: 'തിരഞ്ഞെടുത്ത് അയയ്ക്കുക', type: 'ടൈപ്പ് ചെയ്യുക…',
    not_valid: 'ക്ഷമിക്കണം', not_valid_text: 'Nalla Malayalam-ൽ നിന്ന് WhatsApp-ൽ കിട്ടിയ ലിങ്ക് ആണെങ്കിൽ അവിടെ മറുപടി അയയ്ക്കൂ, ഞങ്ങൾ സഹായിക്കാം.',
  },
  en: {
    brand: 'Nalla Malayalam', other: 'മലയാളം', how: n => `How are you finding the books${n ? ', ' + n : ''}?`, tap: 'Tap a star',
    stars: ['', 'Poor', 'Okay', 'Good', 'Very good', 'Excellent'],
    liked_q: 'What do you like most?', reasons_q: 'Why did you buy them?', changes_q: 'What has changed for your child?', age_q: "Your child's age",
    comment_q: 'In a few words?', optional: '(optional)', many: 'Pick one or more', send: 'Send',
    private: 'Only Nalla Malayalam sees your answer.', err_star: 'Tap a star to rate the books.',
    thanks: n => `Thank you${n ? ', ' + n : ''}!`, got: 'We got your answer.', low: 'Your answer helps us make better books. We read every one.',
    favour: 'One small favour?', favour_text: "Write a short review on our website and send us a screenshot on WhatsApp — we'll send you a coupon for your next order.",
    write_review: 'Write a review on the website', share: 'Share with friends on WhatsApp', done: 'Done', change: 'Change my answer', change_days: '(for 7 days)',
    ask: 'May we show your words on our website?', ask_help: 'It really helps other parents.',
    ask_privacy: 'Only your first name and place. Never your phone number.', yes: 'Yes, show it', no: 'No, thank you',
    ask_E: "Pin it on our readers' wall?", ask_E_sub: "With other parents' cards on nallamalayalam.in", yes_E: '📌 Pin it',
    ask_F: 'Put your card on our website?', ask_F_sub: 'It helps other parents looking for books for their children.', yes_F: 'Yes, put it up',
    parents_say: 'What parents say', any_time: 'You can change this any time from this link.',
    after_yes: "Thank you! We'll add it to the website after a quick check.", after_no: 'Okay — only we will see your answer.',
    remove: 'Take it off the website', show_it: 'Show it on the website', close_now: 'You can close this page now.',
    age_line: a => `parent of a ${a} year old`, skip: 'Skip', next: 'Next →', your_card: 'Your card', card_ph: 'My child…',
    f1: 'How are the books?', f3: 'What do you like, and why did you buy them?', f4: 'Can you say it in a sentence?', starters_hint: 'You could start with:',
    starters: ['My child ', 'We love ', 'To other parents: '], mic: '🎤 Easier to speak? Use the mic on your keyboard.',
    postcard: n => `${n ? n + ', will' : 'Will'} you write us a postcard?`, dear: 'Dear Nalla Malayalam,', stamp: 'Choose your stamp', post: '✉ Post it',
    card_got: 'Your card reached us.', received: 'RECEIVED ✓', write_here: 'Write here…',
    chat_sub: 'Takes about a minute', hello: n => `Hello${n ? ' ' + n : ''} 👋 How are you finding the books? Just tap a star.`,
    good: 'Lovely! 😊', sorry: "Sorry 🙏 we'll do better.", c_liked: 'What do you like most?', c_age: "And your child's age?",
    c_comment: 'Last one: tell us in a few words?', c_thanks: n => `Thank you${n ? ' ' + n : ''}! 🙏 That made our day.`,
    c_ask: 'Can I ask one thing? May we show your words on our website, like this?', pick: 'Pick, then send', type: 'Type…',
    not_valid: 'Sorry', not_valid_text: "If you got this link from Nalla Malayalam on WhatsApp, reply there and we'll help.",
  },
};
// Answer choices: the stored value is the English text; Malayalam label and a picture for each.
const OPT = {
  liked: { Pictures: ['ചിത്രങ്ങൾ', '🎨'], 'Easy to read': ['വായിക്കാൻ എളുപ്പം', '🔤'], Stories: ['കഥകൾ', '📚'], 'Paper and print': ['പേപ്പറും അച്ചടിയും', '📄'], Price: ['വില', '💰'], Other: ['മറ്റുള്ളവ', '✏️'] },
  reasons: { 'For my child to learn Malayalam': ['കുട്ടിയെ മലയാളം പഠിപ്പിക്കാൻ', '🧒'], 'As a gift': ['സമ്മാനമായി', '🎁'], 'For a school or class': ['സ്കൂളിനോ ക്ലാസിനോ', '🏫'], 'For myself': ['എനിക്കുവേണ്ടി', '📖'], Other: ['മറ്റുള്ളവ', '✏️'] },
  changes: { 'Reads on their own': ['സ്വന്തമായി വായിക്കുന്നു', '📖'], 'Knows the letters': ['അക്ഷരങ്ങൾ തിരിച്ചറിയുന്നു', '🔤'], 'Asks for more stories': ['കൂടുതൽ കഥകൾ ചോദിക്കുന്നു', '🌙'], 'Speaks more Malayalam': ['മലയാളം കൂടുതൽ സംസാരിക്കുന്നു', '🗣️'], 'Not started yet': ['ഇതുവരെ തുടങ്ങിയില്ല', '⏳'] },
};

// ---------- State ----------
let d = null;           // the page data from the server
let lang = 'ml';
let screen = 'form';    // form · thanks · ask · closed
let step = 0;           // F: 0–3; C: 0–5
let busy = false; let err = '';
const ans = { stars: 0, liked: [], reasons: [], changes: [], child_age: null, comment: '' };
const STYLE = () => d.style;
const KID = () => STYLE() === 'C' || STYLE() === 'F';  // asks about the child
const t = k => TXT[lang][k];
const label = (g, v) => (lang === 'ml' && OPT[g][v] ? OPT[g][v][0] : v);
const icon = (g, v) => (OPT[g][v] ? OPT[g][v][1] : '');
const name = () => d.first_name || '';
const shownName = () => d.name_shown || d.first_name || '';
const ageText = a => a.replace('-', '–');
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const needAsk = () => d.submitted && d.website.eligible && !d.website.answer && !d.website.review_clicked;
const starsHtml = n => `${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span>`;

async function api(method, path = '', body) {
  const r = await fetch(`/api/public/feedback/${encodeURIComponent(token)}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nm-app' }, body: body && JSON.stringify(body), keepalive: path === '/review-click' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// ---------- Shared pieces ----------
const langBtn = () => `<button type="button" class="fp-lang" data-act="lang" lang="${lang === 'ml' ? 'en' : 'ml'}">${t('other')}</button>`;
const top = () => `<div class="fp-top"><span class="fp-brand">${logo(30)} ${t('brand')}</span>${langBtn()}</div>`;
const starRow = (prompt = t('tap')) => `<div class="fp-stars" role="group" aria-label="${esc(prompt)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-act="star" data-n="${n}" class="${n <= ans.stars ? 'on' : ''}" aria-pressed="${n === ans.stars}" aria-label="${n} / 5">★</button>`).join('')}</div>
  <div class="fp-starword" aria-live="polite">${esc(ans.stars ? t('stars')[ans.stars] : prompt)}</div>`;
/** Answer buttons for one question. tiles: big buttons with a picture, in a two-column grid (style F). */
const chips = (group, opts, tiles = false) => `<div class="${tiles ? 'fp-grid' : 'fp-chips'}" role="group">${opts.map(v => `<button type="button" class="${tiles ? 'fp-tile' : 'fp-chip'}" data-act="pick" data-g="${group}" data-v="${esc(v)}" aria-pressed="${ans[group].includes(v)}">${tiles ? `<span class="e" aria-hidden="true">${icon(group, v)}</span>` : ''}${esc(label(group, v))}</button>`).join('')}</div>`;
const ages = () => `<div class="fp-ages" role="group" aria-label="${esc(t('age_q'))}">${d.options.ages.map(a => `<button type="button" class="fp-chip" data-act="age" data-v="${a}" aria-pressed="${ans.child_age === a}">${ageText(a)}</button>`).join('')}</div>`;
const who = () => `${esc(shownName())}${d.place_shown ? ', ' + esc(d.place_shown) : ''}`;
const ageLine = () => (ans.child_age ? ` <span>· ${esc(t('age_line')(ageText(ans.child_age)))}</span>` : '');
const card = () => `<div class="fp-card"><span class="s">${'★'.repeat(ans.stars)}</span><div class="w">“${esc(ans.comment.trim())}”</div><div class="who">— ${who()}${KID() ? ageLine() : ''}</div></div>`;
const errBox = () => `<div class="fp-err" role="alert">${esc(err)}</div>`;
function reviewBox() {
  const url = d.review_url || d.website_url;
  if (ans.stars < 4 || !url) return '';
  return `<div class="fp-box"><b>${t('favour')}</b><div class="fp-small">${t('favour_text')}</div><a class="fp-main fp-center" data-act="review" href="${esc(url)}" target="_blank" rel="noopener">${t('write_review')}</a></div>`;
}
const shareLink = () => `<p class="fp-center"><a class="fp-link" href="https://wa.me/?text=${encodeURIComponent(d.share_text)}" target="_blank" rel="noopener">${t('share')}</a></p>`;
const changeLink = () => (d.can_change ? `<p class="fp-center fp-small"><button type="button" class="fp-link" data-act="edit">${t('change')}</button> <span class="fp-muted">${t('change_days')}</span></p>` : '');
/** After the website question: what they chose, and how to change it. */
function closedNote() {
  const yes = d.website.answer === 'yes';
  const flip = d.website.eligible || yes ? `<button type="button" class="fp-link" data-act="${yes ? 'no' : 'yes'}">${yes ? t('remove') : t('show_it')}</button>` : '';
  return `<div class="fp-box fp-center"><div>${esc(d.website.answer ? (yes ? t('after_yes') : t('after_no')) : t('close_now'))}</div>${d.website.answer ? `<div class="fp-small fp-muted">${t('any_time')}</div>` : ''}${d.website.answer ? flip : ''}</div>`;
}
function thanksBody({ stars = true } = {}) {
  return `<div class="fp-thanks fp-center">${stars ? `<div class="fp-big-stars" aria-label="${ans.stars} / 5">${starsHtml(ans.stars)}</div>` : ''}<h2>${esc(t('thanks')(name()))}</h2>
    <p class="fp-muted">${ans.stars >= 4 ? (STYLE() === 'E' ? t('card_got') : t('got')) : t('low')}</p>
    ${screen === 'closed' ? closedNote() : reviewBox()}${shareLink()}
    ${screen === 'closed' ? '' : `<button type="button" class="fp-plain" data-act="done">${t('done')}</button>`}${changeLink()}</div>`;
}
function sheet(title, sub, inner, yes) {
  return `<div class="fp-dim" data-act="noop"></div><div class="fp-sheet" role="dialog" aria-modal="true" aria-labelledby="fp-ask-t"><div class="fp-grab"></div>
    <h2 id="fp-ask-t">${esc(title)}</h2><p class="fp-center fp-small fp-muted">${esc(sub)}</p>${inner}
    <p class="fp-center fp-small fp-muted">${esc(t('ask_privacy'))}</p>${errBox()}
    <button type="button" class="fp-main" data-act="yes" ${busy ? 'disabled' : ''}>${esc(yes)}</button><button type="button" class="fp-no" data-act="no" ${busy ? 'disabled' : ''}>${esc(t('no'))}</button></div>`;
}

// ---------- A · Simple page ----------
function renderA() {
  if (screen === 'form') {
    return `<div class="fp-wrap">${top()}<h1 class="fp-h1">${esc(t('how')(name()))}</h1><div class="fp-pad">${starRow()}
      <div class="fp-q">${t('liked_q')}</div>${chips('liked', d.options.liked)}
      <div class="fp-q">${t('reasons_q')}</div>${chips('reasons', d.options.reasons)}
      <div class="fp-q"><label for="fp-c">${t('comment_q')}</label> <span class="fp-muted fp-small">${t('optional')}</span></div>
      <textarea id="fp-c" class="fp-text" data-in="comment" maxlength="1000">${esc(ans.comment)}</textarea>${errBox()}
      <button type="button" class="fp-main fp-send" data-act="send" ${busy ? 'disabled' : ''}>${t('send')}</button><p class="fp-center fp-small fp-muted">${t('private')}</p></div></div>`;
  }
  return `<div class="fp-wrap">${top()}<div class="fp-pad">${thanksBody()}</div></div>${screen === 'ask' ? sheet(t('ask'), t('ask_help'), card(), t('yes')) : ''}`;
}

// ---------- C · WhatsApp-style chat ----------
const C_STEPS = ['stars', 'liked', 'reasons', 'changes', 'age', 'comment'];
function chatSaid(k) {
  if (k === 'stars') return `<span class="s">${'★'.repeat(ans.stars)}</span> ${esc(t('stars')[ans.stars])}`;
  if (k === 'age') return ans.child_age ? esc(ageText(ans.child_age)) : '—';
  if (k === 'comment') return ans.comment.trim() ? esc(ans.comment.trim()) : '—';
  return ans[k].length ? ans[k].map(v => esc(label(k, v))).join(', ') : '—';
}
const chatAsk = k => ({ stars: t('hello')(name()), liked: `${ans.stars >= 4 ? t('good') : t('sorry')} ${t('c_liked')}`, reasons: t('reasons_q'), changes: t('changes_q'), age: t('c_age'), comment: t('c_comment') })[k];
function renderC() {
  const upto = screen === 'form' ? step : C_STEPS.length;
  let msgs = '';
  for (let i = 0; i <= Math.min(upto, C_STEPS.length - 1); i++) {
    msgs += `<div class="fp-msg">${esc(chatAsk(C_STEPS[i]))}</div>`;
    if (i < upto) msgs += `<div class="fp-msg me">${chatSaid(C_STEPS[i])}</div>`;
  }
  let reply = '';
  if (screen === 'form') {
    const k = C_STEPS[step];
    if (k === 'stars') reply = starRow();
    else if (k === 'age') reply = `${ages()}<div class="row"><button type="button" class="fp-skip" data-act="c-next">${t('skip')}</button><button type="button" class="fp-main" data-act="c-next" ${ans.child_age ? '' : 'disabled'}>${t('send')} ➤</button></div>`;
    else if (k === 'comment') reply = `<div class="fp-type"><label class="fp-sr" for="fp-c">${t('comment_q')}</label><textarea id="fp-c" data-in="comment" rows="1" maxlength="1000" placeholder="${esc(t('type'))}">${esc(ans.comment)}</textarea>
      <button type="button" class="fp-send-round" data-act="send" aria-label="${esc(t('send'))}" ${busy ? 'disabled' : ''}>➤</button></div>${errBox()}`;
    else reply = `<div class="lbl">${t('many')} · ${t('pick')}</div>${chips(k, d.options[k])}<div class="row"><button type="button" class="fp-skip" data-act="c-next">${t('skip')}</button><button type="button" class="fp-main" data-act="c-next" ${ans[k].length ? '' : 'disabled'}>${t('send')} ➤</button></div>`;
  } else {
    msgs += `<div class="fp-msg">${esc(ans.stars >= 4 ? t('c_thanks')(name()) : t('low'))}</div>`;
    const url = d.review_url || d.website_url;
    if (ans.stars >= 4 && url && screen !== 'closed') msgs += `<div class="fp-msg">${t('favour')} ${t('favour_text')}<a class="fp-main" data-act="review" href="${esc(url)}" target="_blank" rel="noopener">${t('write_review')}</a></div>`;
    if (screen === 'ask' || d.website.answer) msgs += `<div class="fp-msg">${esc(t('c_ask'))}${card()}<div class="fp-small fp-muted">${esc(t('ask_privacy'))}</div></div>`;
    if (d.website.answer) msgs += `<div class="fp-msg me">${esc(d.website.answer === 'yes' ? t('yes') : t('no'))}</div><div class="fp-msg">${esc(d.website.answer === 'yes' ? t('after_yes') : t('after_no'))} ${esc(t('any_time'))}</div>`;
    if (screen === 'ask') reply = `${errBox()}<div class="fp-chips"><button type="button" class="fp-chip" aria-pressed="true" data-act="yes" ${busy ? 'disabled' : ''}>${t('yes')}</button><button type="button" class="fp-chip" data-act="no" ${busy ? 'disabled' : ''}>${t('no')}</button></div>`;
    else if (screen === 'closed') {
      const yes = d.website.answer === 'yes';
      reply = `<div class="fp-chips">${d.website.answer && (d.website.eligible || yes) ? `<button type="button" class="fp-chip" data-act="${yes ? 'no' : 'yes'}">${yes ? t('remove') : t('show_it')}</button>` : `<span class="fp-small fp-muted">${t('close_now')}</span>`}${d.can_change ? `<button type="button" class="fp-chip" data-act="edit">${t('change')}</button>` : ''}</div>`;
    } else reply = `<div class="fp-chips"><button type="button" class="fp-chip" aria-pressed="true" data-act="done">${t('done')}</button><a class="fp-chip" href="https://wa.me/?text=${encodeURIComponent(d.share_text)}" target="_blank" rel="noopener">${t('share')}</a>${d.can_change ? `<button type="button" class="fp-chip" data-act="edit">${t('change')}</button>` : ''}</div>`;
  }
  return `<div class="fp-wrap"><div class="fp-bar">${logo(30)}<div><div class="n">${t('brand')}</div><div class="sub">${t('chat_sub')}</div></div>${langBtn()}</div>
    <div class="fp-chat" aria-live="polite">${msgs}</div><div class="fp-reply">${reply}</div></div>`;
}

// ---------- E · Postcard ----------
function postcard(withMark) {
  const s = ans.stars;
  const text = screen === 'form' ? `<label class="fp-sr" for="fp-c">${t('comment_q')}</label><textarea id="fp-c" data-in="comment" maxlength="1000" placeholder="${esc(t('write_here'))}">${esc(ans.comment)}</textarea>`
    : `<div class="lines">${esc(ans.comment.trim())}</div>`;
  const today = new Date().toLocaleDateString(lang === 'ml' ? 'ml-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  return `<div class="fp-pc"><div class="hd"><div class="dear">${t('dear')}</div><div class="fp-stamp ${s ? '' : 'empty'}" aria-hidden="true"><b>${s || '?'}</b><i>${'★'.repeat(s)}</i><span>${esc(s ? t('stars')[s] : '')}</span></div></div>
    ${text}<div class="from">— ${who()}</div>${withMark ? `<div class="fp-mark" aria-hidden="true"><span>NALLA MALAYALAM</span><b>${esc(today)}</b><span>${esc(t('received'))}</span></div>` : ''}</div>`;
}
function renderE() {
  if (screen === 'form') {
    return `<div class="fp-wrap">${top()}<h1 class="fp-h1">${esc(t('postcard')(name()))}</h1>${postcard(false)}<div class="fp-pad">
      ${starRow(t('stamp'))}
      <div class="fp-q">${t('liked_q')}</div>${chips('liked', d.options.liked)}<div class="fp-q">${t('reasons_q')}</div>${chips('reasons', d.options.reasons)}
      ${errBox()}<button type="button" class="fp-main fp-post" data-act="send" ${busy ? 'disabled' : ''}>${t('post')}</button><p class="fp-center fp-small fp-muted">${t('private')}</p></div></div>`;
  }
  const wall = `<div class="fp-wall" aria-hidden="true"><div class="ghost g1"></div><div class="ghost g2"></div><div class="mine"><span class="pin">📌</span><span class="s">${'★'.repeat(ans.stars)}</span><br>${esc(ans.comment.trim())}<br><b>— ${who()}</b></div></div>`;
  return `<div class="fp-wrap">${top()}${postcard(true)}<div class="fp-pad">${thanksBody({ stars: false })}</div></div>${screen === 'ask' ? sheet(t('ask_E'), t('ask_E_sub'), wall + `<div class="fp-sr">${card()}</div>`, t('yes_E')) : ''}`;
}

// ---------- F · Your child's story ----------
const F_STEPS = 4;
function liveCard() {
  const tags = ans.changes.map(v => `<span>${esc(label('changes', v))}</span>`).join('');
  const w = ans.comment.trim();
  return `<div class="fp-live" aria-hidden="true"><span class="tag">${t('your_card')}</span><span class="s">${starsHtml(ans.stars)}</span>
    <div class="w ${w ? '' : 'ph'}">${esc(w || t('card_ph'))}</div><div class="who">${who()}${ageLine()}</div>${tags ? `<div class="tags">${tags}</div>` : ''}</div>`;
}
function renderF() {
  const book = lang === 'ml' ? d.book_name_ml || d.book_name : d.book_name;
  const head = n => `<div class="fp-head"><div class="r"><span class="fp-brand">${logo(28, true)} ${t('brand')}</span>${langBtn()}</div>
    ${n ? `<div class="t">${n} / ${F_STEPS}${book ? ' · ' + esc(book) : ''}</div><div class="fp-dots">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>` : `<div class="t">${book ? esc(book) : '&nbsp;'}</div>`}</div>`;
  if (screen !== 'form') {
    const web = `<div class="fp-webcard"><div class="web">🌐 <b>nallamalayalam.in</b> · ${t('parents_say')}</div><span class="s">${'★'.repeat(ans.stars)}</span><div class="w">${esc(ans.comment.trim())}</div><div class="who">${who()}${ageLine()}</div></div>`;
    return `<div class="fp-wrap">${head(0)}${liveCard()}${thanksBody({ stars: false })}</div>${screen === 'ask' ? sheet(t('ask_F'), t('ask_F_sub'), web, t('yes_F')) : ''}`;
  }
  let body;
  if (step === 0) body = `<h1>${esc(t('how')(name()))}</h1>${starRow()}`;
  else if (step === 1) body = `<h1>${t('changes_q')}</h1><div class="hint">${t('many')}</div>${chips('changes', d.options.changes, true)}
    <div class="fp-q">${t('age_q')}</div>${ages()}`;
  else if (step === 2) body = `<h1>${t('f3')}</h1><div class="fp-q">${t('liked_q')}</div>${chips('liked', d.options.liked)}<div class="fp-q">${t('reasons_q')}</div>${chips('reasons', d.options.reasons)}`;
  else body = `<h1><label for="fp-c">${t('f4')}</label></h1><div class="hint">${t('starters_hint')}</div><div class="fp-starters">${t('starters').map((s, i) => `<button type="button" data-act="starter" data-i="${i}">${esc(s.trim())}…</button>`).join('')}</div>
    <textarea id="fp-c" class="fp-text" data-in="comment" maxlength="1000">${esc(ans.comment)}</textarea><div class="fp-small fp-muted">${t('mic')}</div>${errBox()}`;
  const last = step === F_STEPS - 1;
  return `<div class="fp-wrap">${head(step + 1)}${liveCard()}<div class="fp-step">${body}${step < F_STEPS - 1 ? errBox() : ''}</div>
    <div class="fp-nav">${step ? `<button type="button" class="bk" data-act="f-back" aria-label="Back">←</button>` : ''}
      <button type="button" class="nx" data-act="${last ? 'send' : 'f-next'}" ${busy || (step === 0 && !ans.stars) ? 'disabled' : ''}>${last ? t('send') + ' ✓' : t('next')}</button></div></div>`;
}

// ---------- Drawing and events ----------
function render(focusSel) {
  document.body.className = `fp fp-${STYLE()}`;
  document.documentElement.lang = lang;
  box.innerHTML = ({ A: renderA, C: renderC, E: renderE, F: renderF })[STYLE()]();
  if (focusSel) box.querySelector(focusSel)?.focus();
  if (STYLE() === 'C') box.querySelector('.fp-chat')?.lastElementChild?.scrollIntoView({ block: 'end' });
}
function fromView(v) {
  d = v;
  Object.assign(ans, { stars: v.stars || 0, liked: v.liked || [], reasons: v.reasons || [], changes: v.changes || [], child_age: v.child_age || null, comment: v.comment || '' });
}
async function send() {
  err = '';
  if (!ans.stars) { err = t('err_star'); if (STYLE() === 'F') step = 0; if (STYLE() === 'C') step = 0; render(); return; }
  busy = true; render();
  try {
    const body = { stars: ans.stars, liked: ans.liked, reasons: ans.reasons, comment: ans.comment, style: STYLE(), lang };
    if (KID()) Object.assign(body, { changes: ans.changes, child_age: ans.child_age });
    fromView(await api('POST', '', body));
    screen = 'thanks';
    history.pushState({ fp: 'thanks' }, '');
    window.scrollTo(0, 0);
  } catch (x) { err = x.message; }
  busy = false; render();
}
async function website(answer) {
  busy = true; err = ''; render();
  try { fromView(await api('POST', '/website', { answer })); screen = 'closed'; } catch (x) { err = x.message; }
  busy = false; render();
}
function leave() {
  // Done (or Back) without writing a website review: ask about the website once, if it fits.
  if (needAsk()) { screen = 'ask'; render('.fp-sheet .fp-main, .fp-reply [data-act="yes"]'); } else { screen = 'closed'; render(); }
}

box.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'lang') { lang = lang === 'ml' ? 'en' : 'ml'; store.set('nm-fb-lang', lang); render('.fp-lang'); return; }
  if (act === 'star') {
    ans.stars = Number(b.dataset.n); err = '';
    if (STYLE() === 'C' && screen === 'form' && step === 0) { step = 1; render(); return; }
    render(`[data-act="star"][data-n="${ans.stars}"]`); return;
  }
  if (act === 'pick') {
    const g = b.dataset.g; const v = b.dataset.v; const i = ans[g].indexOf(v);
    if (i >= 0) ans[g].splice(i, 1); else ans[g].push(v);
    render(`[data-act="pick"][data-g="${g}"][data-v="${CSS.escape(v)}"]`); return;
  }
  if (act === 'age') { ans.child_age = ans.child_age === b.dataset.v ? null : b.dataset.v; render(`[data-act="age"][data-v="${b.dataset.v}"]`); return; }
  if (act === 'c-next') {
    // Skip clears what was picked for this step; Send keeps it.
    if (b.classList.contains('fp-skip')) { const k = C_STEPS[step]; if (k === 'age') ans.child_age = null; else ans[k] = []; }
    step++; render(step === C_STEPS.length - 1 ? '#fp-c' : null); return;
  }
  if (act === 'f-next') { if (!ans.stars) { err = t('err_star'); render(); return; } err = ''; step = Math.min(step + 1, F_STEPS - 1); render(); window.scrollTo(0, 0); return; }
  if (act === 'f-back') { step = Math.max(step - 1, 0); err = ''; render(); return; }
  if (act === 'starter') {
    const s = t('starters')[Number(b.dataset.i)]; const ta = box.querySelector('#fp-c');
    ans.comment = (ans.comment.trim() ? ans.comment.trimEnd() + ' ' : '') + s; ta.value = ans.comment; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); syncLive(); return;
  }
  if (act === 'send') { send(); return; }
  if (act === 'done') { leave(); return; }
  if (act === 'review') { d.website.review_clicked = true; api('POST', '/review-click').catch(() => {}); return; } // the link opens the website
  if (act === 'yes' || act === 'no') { website(act); return; }
  if (act === 'edit') { screen = 'form'; step = 0; err = ''; render(); window.scrollTo(0, 0); }
});
// Typing updates the comment and the live card or stamp without redrawing (so the keyboard stays open).
function syncLive() {
  const w = box.querySelector('.fp-live .w');
  if (w) { w.textContent = ans.comment.trim() || t('card_ph'); w.classList.toggle('ph', !ans.comment.trim()); }
}
box.addEventListener('input', e => { if (e.target.dataset.in === 'comment') { ans.comment = e.target.value; syncLive(); } });
// The phone's Back button on the thank-you: ask the website question first (once), then let them go.
window.addEventListener('popstate', () => {
  if (screen === 'thanks' && needAsk()) { screen = 'ask'; render(); history.pushState({ fp: 'ask' }, ''); }
});

api('GET').then(v => {
  fromView(v);
  lang = new URLSearchParams(location.search).get('lang') || v.lang || store.get('nm-fb-lang') || 'ml';
  if (!TXT[lang]) lang = 'ml';
  // Coming back to the link: the thank-you, with the website question if it was never answered.
  if (v.submitted) { screen = needAsk() ? 'ask' : 'closed'; history.pushState({ fp: 'thanks' }, ''); }
  render();
}).catch(e => {
  lang = store.get('nm-fb-lang') === 'en' ? 'en' : 'ml';
  document.body.className = 'fp fp-A';
  box.innerHTML = `<div class="fp-wrap">${top().replace(langBtn(), '')}<div class="fp-pad"><h1 class="fp-h1">${t('not_valid')}</h1><p>${esc(e.message)}</p><p class="fp-muted">${t('not_valid_text')}</p></div></div>`;
});
