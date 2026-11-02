/* Клиент «Бронь без конфликтов»: одностраничное приложение без фреймворков.
   Страницы: вход, каталог, карточка ресурса с формой, мои записи, панель администратора. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');

const STATE = { upcoming: 'Предстоит', in_progress: 'Идёт', finished: 'Завершена', cancelled: 'Отменена' };
const stateBadge = (s) => `<span class="badge state-${s}">${STATE[s] || s}</span>`;

// ---------- сессия ----------
let session = null;
try { session = JSON.parse(sessionStorage.getItem('session') || 'null'); } catch { session = null; }
function saveSession(s) {
  session = s;
  try { s ? sessionStorage.setItem('session', JSON.stringify(s)) : sessionStorage.removeItem('session'); } catch { /* хранилище недоступно */ }
}

// ---------- время (МСК) ----------
const fmtDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const fmtRange = (a, b) => `${fmtDate(a)}, ${fmtTime(a)}–${fmtTime(b)} МСК`;
const mskToday = (plus = 0) => new Date(Date.now() + 3 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayLabel = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}, ${WD[new Date(Date.UTC(+y, m - 1, +d)).getUTCDay()]}`; };
const dayOptions = (from, to, sel) => { let o = ''; for (let i = from; i <= to; i++) { const v = mskToday(i); o += `<option value="${v}"${v === sel ? ' selected' : ''}>${dayLabel(v)}</option>`; } return o; };
const slots = (() => { const r = []; for (let m = 8 * 60; m <= 22 * 60; m += 30) r.push(`${String(m / 60 | 0).padStart(2, '0')}:${m % 60 ? '30' : '00'}`); return r; })();

// ---------- API ----------
class NetError extends Error {}
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (session) h.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new NetError('Нет соединения с сервером. Введённые данные сохранены — повторите, когда связь восстановится.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) {
    saveSession(null);
    showBanner('Срок действия входа истёк. Войдите снова — после входа вы вернётесь на эту страницу.');
    sessionStorage.setItem('returnTo', location.hash);
    location.hash = '#/login';
  }
  return { ok: res.ok, status: res.status, data };
}
const errText = (d) => `${esc(d.message || 'Ошибка')}${d.traceId ? ` <span class="muted">(код для поддержки: ${esc(d.traceId)})</span>` : ''}`;

function showBanner(text) { const b = $('#banner'); b.textContent = text; b.hidden = !text; }
window.addEventListener('offline', () => showBanner('Нет подключения к сети. Данные форм сохраняются на странице.'));
window.addEventListener('online', () => showBanner(''));

// ---------- навигация ----------
function renderNav(active) {
  const links = session ? [['#/catalog', 'Каталог'], ['#/my', 'Мои записи']].concat(session.user.role === 'admin' ? [['#/admin', 'Администрирование']] : []) : [];
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}" ${active === h ? 'aria-current="page"' : ''}>${t}</a>`).join('') +
    (session ? `<span class="who">${esc(session.user.fullName)}</span><button id="logout" type="button">Выйти</button>` : '');
  if (session) $('#logout').onclick = () => { saveSession(null); location.hash = '#/login'; };
}

const routes = [
  [/^#\/login$/, pageLogin], [/^#\/catalog$/, pageCatalog], [/^#\/resource\/(\d+)$/, pageResource],
  [/^#\/my$/, pageMy], [/^#\/admin$/, pageAdmin]
];
function router() {
  const hash = location.hash || '#/catalog';
  if (!session && hash !== '#/login') { location.hash = '#/login'; return; }
  for (const [re, page] of routes) {
    const m = hash.match(re);
    if (m) { renderNav(hash.startsWith('#/resource') ? '#/catalog' : hash); page(...m.slice(1)); main.focus(); return; }
  }
  location.hash = '#/catalog';
}
window.addEventListener('hashchange', router);

const loading = () => '<p class="loading" role="status">Загрузка…</p>';
function failBox(e, retry) {
  const text = e instanceof NetError ? esc(e.message) : errText(e);
  return `<div class="msg error" role="alert">${text}</div>${retry ? '<button class="btn secondary" type="button" data-retry>Повторить</button>' : ''}`;
}
function setFieldErrors(form, fields = {}) {
  form.querySelectorAll('.field').forEach((f) => { f.classList.remove('invalid'); const e = f.querySelector('.ferr'); if (e) e.remove(); });
  for (const [name, text] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${name}"]`) || form.querySelector(`[data-for="${name}"]`);
    const field = input && input.closest('.field');
    if (!field) continue;
    field.classList.add('invalid');
    field.insertAdjacentHTML('beforeend', `<div class="ferr" id="err-${name}">${esc(text)}</div>`);
    if (input.setAttribute) input.setAttribute('aria-describedby', `err-${name}`);
  }
}

// ---------- вход и регистрация ----------
function pageLogin() {
  let mode = 'login';
  const draw = () => {
    main.innerHTML = `<div class="card" style="max-width:420px;margin:24px auto">
      <h1>${mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
      <form id="f" novalidate>
        ${mode === 'register' ? '<div class="field"><label for="fullName">Имя и фамилия</label><input id="fullName" name="fullName" autocomplete="name" required></div>' : ''}
        <div class="field"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" required></div>
        <div class="field"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
        <div id="m" aria-live="polite"></div>
        <div class="row"><button class="btn" type="submit">${mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        <button class="btn secondary" type="button" id="sw">${mode === 'login' ? 'Создать учётную запись' : 'У меня есть учётная запись'}</button></div>
      </form></div>`;
    $('#sw').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const form = ev.target; const btn = form.querySelector('[type=submit]');
      const body = Object.fromEntries(new FormData(form));
      btn.disabled = true; btn.textContent = 'Отправка…'; $('#m').innerHTML = '';
      try {
        const { ok, data } = await api(`/api/auth/${mode}`, { method: 'POST', body });
        if (!ok) { setFieldErrors(form, data.fields); $('#m').innerHTML = `<div class="msg error" role="alert">${errText(data)}</div>`; return; }
        saveSession({ token: data.token, user: data.user });
        showBanner('');
        const back = sessionStorage.getItem('returnTo'); sessionStorage.removeItem('returnTo');
        location.hash = back && back !== '#/login' ? back : '#/catalog';
      } catch (e) { $('#m').innerHTML = failBox(e); } finally { btn.disabled = false; btn.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться'; }
    };
  };
  renderNav(''); draw();
}

// ---------- каталог ----------
const catalogState = { q: '', location: '' };
async function pageCatalog() {
  main.innerHTML = `<h1>Каталог аудиторий</h1>
    <div class="card"><form id="flt" class="grid" role="search">
      <div class="field"><label for="q">Поиск по названию</label><input id="q" name="q" value="${esc(catalogState.q)}" placeholder="например, 204"></div>
      <div class="field"><label for="loc">Местоположение</label><select id="loc" name="location"><option value="">Все корпуса</option></select></div>
    </form></div><div class="card" id="res">${loading()}</div>`;
  const load = async () => {
    const box = $('#res'); box.innerHTML = loading();
    const qs = new URLSearchParams({ q: catalogState.q, location: catalogState.location });
    try {
      const { ok, data } = await api(`/api/resources?${qs}`);
      if (!ok) { box.innerHTML = failBox(data, true); return; }
      box.innerHTML = data.length ? `<ul class="list">${data.map((r) => `<li><a class="res-title" href="#/resource/${r.id}">${esc(r.name)}</a>
        <div class="muted">${esc(r.location)} · до ${r.capacity} чел.</div><div>${esc(r.description)}</div></li>`).join('')}</ul>`
        : '<p class="msg info">Ничего не найдено. Измените запрос или выберите другой корпус.</p>';
    } catch (e) { box.innerHTML = failBox(e, true); }
    const r = box.querySelector('[data-retry]'); if (r) r.onclick = load;
  };
  try {
    const { ok, data } = await api('/api/resources/locations');
    if (ok) $('#loc').insertAdjacentHTML('beforeend', data.map((l) => `<option ${l === catalogState.location ? 'selected' : ''}>${esc(l)}</option>`).join(''));
  } catch { /* фильтр останется пустым, список загрузится ниже */ }
  let t;
  $('#q').oninput = (e) => { catalogState.q = e.target.value; clearTimeout(t); t = setTimeout(load, 300); };
  $('#loc').onchange = (e) => { catalogState.location = e.target.value; load(); };
  $('#flt').onsubmit = (e) => { e.preventDefault(); load(); };
  load();
}

// ---------- карточка ресурса и форма бронирования ----------
// черновик формы и ключ попытки хранятся в памяти страницы: при сбое сети данные не теряются,
// а повтор отправляется с тем же Idempotency-Key
const drafts = {};
async function pageResource(id) {
  main.innerHTML = loading();
  let r;
  try {
    const res = await api(`/api/resources/${id}`);
    if (!res.ok) { main.innerHTML = failBox(res.data); return; }
    r = res.data;
  } catch (e) { main.innerHTML = failBox(e); return; }
  const d = drafts[id] || (drafts[id] = { date: mskToday(1), from: '10:00', to: '11:00', purpose: '', confirm: false, key: null, sig: null });
  const opts = (sel) => slots.map((s) => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
  main.innerHTML = `<p><a href="#/catalog">← Каталог</a></p>
    <div class="card"><h1>${esc(r.name)}</h1><div class="muted">${esc(r.location)} · вместимость до ${r.capacity} чел.</div>
      <p>${esc(r.description)}</p>${r.isActive ? '' : '<div class="msg error">Ресурс отключён администратором: новые бронирования недоступны.</div>'}</div>
    <div class="card"><h2>Занятость</h2>
      <div class="field" style="max-width:220px"><label for="bdate">Дата</label><select id="bdate">${dayOptions(0, 30, d.date)}</select></div>
      <div id="busy">${loading()}</div></div>
    <div class="card"><h2>Новая запись</h2>
      <form id="bf" novalidate>
        <div class="grid">
          <div class="field"><label for="from">Начало (МСК)</label><select id="from" name="from" data-for="startsAt">${opts(d.from)}</select></div>
          <div class="field"><label for="to">Окончание (МСК)</label><select id="to" name="to" data-for="endsAt">${opts(d.to)}</select></div>
        </div>
        <div class="field"><label for="purpose">Цель бронирования</label><textarea id="purpose" name="purpose" maxlength="300" required>${esc(d.purpose)}</textarea>
          <div class="hint">От 5 до 300 символов. Шаг времени — 30 минут, продолжительность — от 30 минут до 4 часов, с 08:00 до 22:00.</div></div>
        <div class="field"><label><input type="checkbox" id="confirm" name="confirm" style="width:auto" ${d.confirm ? 'checked' : ''}> Подтверждаю бронирование</label></div>
        <input type="hidden" name="resourceId" data-for="resourceId">
        <div id="bm" aria-live="polite"></div>
        <button class="btn" type="submit" ${r.isActive ? '' : 'disabled'}>Забронировать</button>
      </form></div>`;

  const loadBusy = async () => {
    const box = $('#busy'); box.innerHTML = loading();
    try {
      const { ok, data } = await api(`/api/resources/${id}/availability?date=${d.date}`);
      if (!ok) { box.innerHTML = failBox(data, true); return; }
      box.innerHTML = data.busy.length ? `<ul class="list busy">${data.busy.map((b) => `<li>Занято ${fmtTime(b.startsAt)}–${fmtTime(b.endsAt)} МСК${b.mine ? ' <span class="badge state-upcoming">ваша запись</span>' : ''}</li>`).join('')}</ul>`
        : '<p class="msg info">На выбранную дату свободно весь день (08:00–22:00 МСК).</p>';
    } catch (e) { box.innerHTML = failBox(e, true); }
    const rb = box.querySelector('[data-retry]'); if (rb) rb.onclick = loadBusy;
  };
  $('#bdate').onchange = (e) => { d.date = e.target.value; loadBusy(); };
  const form = $('#bf');
  form.oninput = () => { d.from = $('#from').value; d.to = $('#to').value; d.purpose = $('#purpose').value; d.confirm = $('#confirm').checked; };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]'); const m = $('#bm');
    setFieldErrors(form, {}); m.innerHTML = '';
    if (!d.confirm) { m.innerHTML = '<div class="msg error" role="alert">Отметьте подтверждение бронирования.</div>'; return; }
    const body = { resourceId: Number(id), startsAt: `${d.date}T${d.from}:00+03:00`, endsAt: `${d.date}T${d.to}:00+03:00`, purpose: d.purpose.trim() };
    const sig = JSON.stringify(body);
    // новый ключ — только для новой операции (изменились ресурс, время или цель)
    if (d.sig !== sig || !d.key) { d.key = crypto.randomUUID(); d.sig = sig; }
    btn.disabled = true; btn.textContent = 'Отправка…';
    try {
      const { ok, status, data } = await api('/api/bookings', { method: 'POST', body, headers: { 'Idempotency-Key': d.key } });
      if (ok) {
        m.innerHTML = `<div class="msg ok" role="status"><b>Запись №${data.id} ${status === 201 ? 'создана' : 'уже была создана ранее (повторная отправка)'}</b><br>
          ${esc(data.resourceName)} · ${fmtRange(data.startsAt, data.endsAt)}<br><a href="#/my">Перейти к моим записям</a></div>`;
        drafts[id] = null; loadBusy();
      } else {
        setFieldErrors(form, data.fields);
        m.innerHTML = `<div class="msg error" role="alert">${errText(data)}</div>`;
        if (status === 409 && data.error === 'overlap') loadBusy();
      }
    } catch (e) {
      m.innerHTML = `<div class="msg error" role="alert">${esc(e.message)}</div><button class="btn secondary" type="button" id="again">Повторить отправку</button>`;
      $('#again').onclick = () => form.requestSubmit();
    } finally { btn.disabled = !r.isActive; btn.textContent = 'Забронировать'; }
  };
  loadBusy();
}

// ---------- мои записи ----------
let myFilter = '';
async function pageMy() {
  main.innerHTML = `<h1>Мои записи</h1><div class="card"><div class="field" style="max-width:260px"><label for="sf">Статус</label>
    <select id="sf"><option value="">Все</option>${Object.entries(STATE).map(([k, v]) => `<option value="${k}" ${k === myFilter ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div id="mm" aria-live="polite"></div><div id="ml">${loading()}</div></div>`;
  const load = async () => {
    const box = $('#ml'); box.innerHTML = loading();
    try {
      const { ok, data } = await api(`/api/bookings/my${myFilter ? `?state=${myFilter}` : ''}`);
      if (!ok) { box.innerHTML = failBox(data, true); return; }
      if (!data.length) { box.innerHTML = '<p class="msg info">Записей нет. Выберите аудиторию в <a href="#/catalog">каталоге</a>.</p>'; return; }
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>№</th><th>Ресурс</th><th>Время</th><th>Цель</th><th>Статус</th><th></th></tr></thead><tbody>
        ${data.map((b) => `<tr><td>${b.id}</td><td>${esc(b.resourceName)}</td><td>${fmtRange(b.startsAt, b.endsAt)}</td><td>${esc(b.purpose)}</td>
        <td>${stateBadge(b.state)}${b.cancelReason ? `<div class="muted">Причина: ${esc(b.cancelReason)}</div>` : ''}</td>
        <td>${b.state === 'upcoming' ? `<button class="btn secondary" type="button" data-c="${b.id}">Отменить</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      box.querySelectorAll('[data-c]').forEach((btn) => { btn.onclick = () => askCancel(btn); });
    } catch (e) { box.innerHTML = failBox(e, true); }
    const rb = box.querySelector('[data-retry]'); if (rb) rb.onclick = load;
  };
  const askCancel = (btn) => {
    const cell = btn.parentElement;
    cell.innerHTML = `<div class="muted">Отменить запись №${btn.dataset.c}?</div><div class="row"><button class="btn danger" type="button" data-yes>Да, отменить</button><button class="btn secondary" type="button" data-no>Нет</button></div>`;
    cell.querySelector('[data-no]').onclick = load;
    const yes = cell.querySelector('[data-yes]'); yes.focus();
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        const { ok, data } = await api(`/api/bookings/${btn.dataset.c}/cancel`, { method: 'POST', body: {} });
        $('#mm').innerHTML = ok ? `<div class="msg ok">Запись №${data.id} отменена, время освобождено.</div>` : `<div class="msg error">${errText(data)}</div>`;
      } catch (e) { $('#mm').innerHTML = failBox(e); }
      load();
    };
  };
  $('#sf').onchange = (e) => { myFilter = e.target.value; load(); };
  load();
}

// ---------- администрирование ----------
let adminTab = 'bookings';
async function pageAdmin() {
  if (session.user.role !== 'admin') { main.innerHTML = '<div class="msg error">Раздел доступен только администратору.</div>'; return; }
  const tabs = [['bookings', 'Все записи'], ['resources', 'Ресурсы'], ['audit', 'Аудит']];
  main.innerHTML = `<h1>Администрирование</h1><div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${k === adminTab}">${t}</button>`).join('')}</div><div class="card" id="ab"></div>`;
  main.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { adminTab = b.dataset.t; pageAdmin(); }; });
  ({ bookings: adminBookings, resources: adminResources, audit: adminAudit })[adminTab]($('#ab'));
}

const adminFilter = { date: '', resourceId: '', state: '' };
async function adminBookings(box) {
  let res = [];
  try { const r = await api('/api/admin/resources'); if (r.ok) res = r.data; } catch { /* фильтр ресурса будет пустым */ }
  box.innerHTML = `<form id="af" class="grid">
    <div class="field"><label for="ad">Дата</label><select id="ad" name="date"><option value="">Все даты</option>${dayOptions(-7, 30, adminFilter.date)}</select></div>
    <div class="field"><label for="ar">Ресурс</label><select id="ar" name="resourceId"><option value="">Все</option>${res.map((r) => `<option value="${r.id}" ${String(r.id) === adminFilter.resourceId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="as">Статус</label><select id="as" name="state"><option value="">Все</option>${Object.entries(STATE).map(([k, v]) => `<option value="${k}" ${k === adminFilter.state ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  </form><div id="am" aria-live="polite"></div><div id="al">${loading()}</div>`;
  const load = async () => {
    const list = $('#al'); list.innerHTML = loading();
    const qs = new URLSearchParams(Object.entries(adminFilter).filter(([, v]) => v));
    try {
      const { ok, data } = await api(`/api/admin/bookings?${qs}`);
      if (!ok) { list.innerHTML = failBox(data, true); return; }
      list.innerHTML = data.length ? `<div class="table-wrap"><table><thead><tr><th>№</th><th>Ресурс</th><th>Владелец</th><th>Время</th><th>Цель</th><th>Статус</th><th></th></tr></thead><tbody>
        ${data.map((b) => `<tr><td>${b.id}</td><td>${esc(b.resourceName)}</td><td>${esc(b.userName)} (${esc(b.userLogin)})</td><td>${fmtRange(b.startsAt, b.endsAt)}</td><td>${esc(b.purpose)}</td>
        <td>${stateBadge(b.state)}${b.cancelReason ? `<div class="muted">${esc(b.cancelReason)}</div>` : ''}</td>
        <td>${b.state === 'upcoming' ? `<button class="btn secondary" type="button" data-c="${b.id}">Отменить</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="msg info">Записей по выбранным условиям нет.</p>';
      list.querySelectorAll('[data-c]').forEach((btn) => {
        btn.onclick = () => {
          const cell = btn.parentElement;
          cell.innerHTML = `<div class="field"><label for="rs${btn.dataset.c}">Причина отмены</label><input id="rs${btn.dataset.c}" name="reason" maxlength="300"></div>
            <div class="row"><button class="btn danger" type="button" data-yes>Отменить запись</button><button class="btn secondary" type="button" data-no>Назад</button></div>`;
          cell.querySelector('input').focus();
          cell.querySelector('[data-no]').onclick = load;
          cell.querySelector('[data-yes]').onclick = async () => {
            const reason = cell.querySelector('input').value;
            try {
              const { ok: ok2, data: d2 } = await api(`/api/bookings/${btn.dataset.c}/cancel`, { method: 'POST', body: { reason } });
              if (!ok2) { setFieldErrors(cell, d2.fields); $('#am').innerHTML = `<div class="msg error">${errText(d2)}</div>`; return; }
              $('#am').innerHTML = `<div class="msg ok">Запись №${d2.id} отменена.</div>`; load();
            } catch (e) { $('#am').innerHTML = failBox(e); }
          };
        };
      });
    } catch (e) { list.innerHTML = failBox(e, true); }
    const rb = list.querySelector('[data-retry]'); if (rb) rb.onclick = load;
  };
  $('#af').onchange = (e) => { adminFilter[e.target.name] = e.target.value; load(); };
  load();
}

async function adminResources(box) {
  box.innerHTML = `<h2>Новый ресурс</h2><form id="rf" class="grid" novalidate>
    <div class="field"><label for="rn">Название</label><input id="rn" name="name" maxlength="100"></div>
    <div class="field"><label for="rl">Местоположение</label><input id="rl" name="location" maxlength="100"></div>
    <div class="field"><label for="rc">Вместимость</label><input id="rc" name="capacity" type="number" min="1" max="1000"></div>
    <div class="field" style="grid-column:1/-1"><label for="rd">Описание</label><input id="rd" name="description" maxlength="500"></div>
    <div><button class="btn" type="submit">Добавить</button></div></form>
    <div id="rm" aria-live="polite"></div><h2 style="margin-top:16px">Все ресурсы</h2><div id="rlist">${loading()}</div>`;
  const load = async () => {
    const list = $('#rlist');
    try {
      const { ok, data } = await api('/api/admin/resources');
      if (!ok) { list.innerHTML = failBox(data, true); return; }
      list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>№</th><th>Название</th><th>Местоположение</th><th>Мест</th><th>Состояние</th><th></th></tr></thead><tbody>
        ${data.map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}<div class="muted">${esc(r.description)}</div></td><td>${esc(r.location)}</td><td>${r.capacity}</td>
        <td>${r.isActive ? 'Доступен' : '<b>Отключён</b>'}</td>
        <td><button class="btn secondary" type="button" data-id="${r.id}" data-on="${!r.isActive}">${r.isActive ? 'Отключить' : 'Включить'}</button></td></tr>`).join('')}</tbody></table></div>`;
      list.querySelectorAll('[data-id]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const { ok: ok2, data: d2 } = await api(`/api/admin/resources/${b.dataset.id}`, { method: 'PATCH', body: { isActive: b.dataset.on === 'true' } });
            $('#rm').innerHTML = ok2 ? `<div class="msg ok">Ресурс «${esc(d2.name)}» ${d2.isActive ? 'включён' : 'отключён для новых бронирований'}.</div>` : `<div class="msg error">${errText(d2)}</div>`;
          } catch (e) { $('#rm').innerHTML = failBox(e); }
          load();
        };
      });
    } catch (e) { list.innerHTML = failBox(e, true); }
  };
  $('#rf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    f.capacity = Number(f.capacity);
    try {
      const { ok, data } = await api('/api/admin/resources', { method: 'POST', body: f });
      setFieldErrors(ev.target, ok ? {} : data.fields);
      $('#rm').innerHTML = ok ? `<div class="msg ok">Ресурс «${esc(data.name)}» добавлен.</div>` : `<div class="msg error">${errText(data)}</div>`;
      if (ok) { ev.target.reset(); load(); }
    } catch (e) { $('#rm').innerHTML = failBox(e); }
  };
  load();
}

async function adminAudit(box) {
  box.innerHTML = loading();
  try {
    const { ok, data } = await api('/api/admin/audit?limit=100');
    if (!ok) { box.innerHTML = failBox(data); return; }
    const ACT = { 'booking.create': 'Создание записи', 'booking.cancel': 'Отмена записи', 'resource.create': 'Создание ресурса',
      'resource.update': 'Изменение ресурса', 'resource.disable': 'Отключение ресурса', 'resource.enable': 'Включение ресурса' };
    box.innerHTML = data.length ? `<div class="table-wrap"><table><thead><tr><th>Время (МСК)</th><th>Исполнитель</th><th>Действие</th><th>Объект</th><th>Результат</th><th>traceId</th></tr></thead><tbody>
      ${data.map((a) => `<tr><td>${fmtDate(a.at)} ${new Date(a.at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}</td><td>${esc(a.actor || '—')}</td><td>${esc(ACT[a.action] || a.action)}</td>
      <td>${esc(a.objectType)} №${a.objectId ?? '—'}</td><td>${a.result === 'success' ? 'успешно' : 'отклонено'}</td><td class="muted">${esc(a.requestId.slice(0, 8))}…</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="msg info">Событий пока нет.</p>';
  } catch (e) { box.innerHTML = failBox(e); }
}

router();
