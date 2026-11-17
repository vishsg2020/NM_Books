import { api, get, esc, html, raw, pill, table, drawer, onSubmit, options, toast, roleName, ROLES, state, fmtStamp } from '../core.js';

export async function render(page) {
  const users = await get('/api/users');
  page.innerHTML = `<div class="page-head"><div><h1>Users</h1><div class="sub">Who can sign in, and with which role.</div></div>
    <div class="actions"><button class="btn primary" type="button" id="add-u">Add user</button></div></div><div id="u-list"></div>`;
  page.querySelector('#u-list').innerHTML = table([
    { label: 'Name', cell: u => `${esc(u.name)}${u.id === state.me.id ? ' <span class="muted">(you)</span>' : ''}<span class="sub">${esc(u.email)}</span>` },
    { label: 'Role', cell: u => esc(roleName(u.role)) },
    { label: 'Created', cell: u => esc(fmtStamp(u.created_at)) },
    { label: 'Status', cell: u => pill(u.active ? 'Active' : 'Inactive').__raw },
    { label: 'Actions', cls: 'cell-actions', cell: u => `<button class="btn small" type="button" data-edit="${u.id}">Edit</button>` },
  ], users);
  const reload = () => { window.dispatchEvent(new Event('nm:changed')); render(page); };
  page.querySelector('#add-u').addEventListener('click', () => userForm(null, reload));
  page.querySelector('#u-list').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (b) userForm(users.find(u => String(u.id) === b.dataset.edit), reload);
  });
}

function userForm(u, after) {
  const editing = !!u; const self = editing && u.id === state.me.id;
  drawer({
    title: editing ? `Edit ${u.name}` : 'Add user',
    body: html`<form id="u-form" novalidate>
      <div class="field"><label for="u-name">Name *</label><input id="u-name" name="name" required maxlength="100" value="${u?.name}"></div>
      ${raw(editing ? `<p class="muted">${esc(u.email)}</p>` : `<div class="field"><label for="u-email">Email *</label><input id="u-email" name="email" type="email" required autocomplete="off"></div>`)}
      ${raw(self ? `<p class="muted">Role: ${esc(roleName(u.role))}</p>` : `<div class="field"><label for="u-role">Role *</label><select id="u-role" name="role">${options(ROLES, u?.role || 'telesales')}</select>
        <div class="hint">Sales team roles record sales for their own channel only. Changing a role signs the user out.</div></div>`)}
      <div class="field"><label for="u-pw">${editing ? 'New password' : 'Password *'}</label><input id="u-pw" name="password" type="password" minlength="8" autocomplete="new-password">
        <div class="hint">${editing ? 'Leave blank to keep the current password. ' : ''}At least 8 characters. Share it privately.</div></div>
      ${raw(editing && !self ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Can sign in</label>` : '')}
    </form>`,
    foot: `<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" form="u-form">${editing ? 'Save user' : 'Add user'}</button>`,
    onMount: (d, close) => {
      onSubmit(d.querySelector('#u-form'), async v => {
        if (editing) {
          const body = { name: v.name };
          if (v.role) body.role = v.role;
          if (v.password) body.password = v.password;
          if (v.active !== undefined) body.active = v.active;
          await api('PATCH', `/api/users/${u.id}`, body);
        } else await api('POST', '/api/users', v);
        close(); toast(editing ? 'User saved' : 'User added'); after();
      });
    },
  });
}

export async function renderAccount(page) {
  page.innerHTML = `<div class="page-head"><div><h1>Change password</h1><div class="sub">${esc(state.me.email)}</div></div></div>
    <section class="panel"><form id="pw-form" novalidate>
      <div class="field"><label for="pw-c">Current password</label><input id="pw-c" name="current_password" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pw-n">New password</label><input id="pw-n" name="new_password" type="password" minlength="8" autocomplete="new-password"><div class="hint">At least 8 characters.</div></div>
      <button class="btn primary" type="submit">Change password</button></form></section>`;
  const form = page.querySelector('#pw-form');
  onSubmit(form, async v => { await api('POST', '/api/me/password', v); form.reset(); toast('Password changed'); });
}
