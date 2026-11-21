// 0.2.0 item 31: File > Sign in as admin… elevates THIS session in place (same token, same pairing, same speaker - the music keeps playing),
// File > Leave admin mode drops back to the paired role. No sign-out and no new pairing code either way. The header shows an "Admin" chip meanwhile.
import { h, api, toast, dialog, ask } from './util.js';

export async function refreshAuth(S) {
  try { S.auth = await api('/auth/state'); } catch (e) { toast(e.message, true); return; }
  try { window.dispatchEvent(new CustomEvent('wavwiz:auth', { detail: S.auth })); } catch { /* no DOM */ }
}

export function signInAsAdmin(S) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'elev-pw' }), msg = h('p', { class: 'err', role: 'alert' });
  const submit = async () => {
    msg.textContent = '';
    try { await api('/auth/elevate', { method: 'POST', body: { password: pw.value } }); }
    catch (e) { msg.textContent = e.status === 401 ? 'That password is not right.' : e.message; pw.select(); return false; }
    await refreshAuth(S); toast('You are signed in as admin. File > Leave admin mode switches back.');
    return true;
  };
  const d = dialog('Sign in as admin', h('form', { onsubmit: async ev => { ev.preventDefault(); if (await submit()) d.close(); } },
    h('p', { class: 'dim small' }, 'Type the administrator password. This browser stays paired and keeps playing; File > Leave admin mode switches back.'),
    h('div', { class: 'field' }, h('label', { for: 'elev-pw' }, 'Administrator password'), pw), msg),
    [{ text: 'Sign in as admin', cls: 'primary', onclick: submit }, { text: 'Cancel' }]);
  setTimeout(() => pw.focus(), 30);
  return d;
}

export async function leaveAdmin(S) {
  try { await api('/auth/leave-admin', { method: 'POST' }); } catch (e) { return toast(e.message, true); }
  await refreshAuth(S); toast('Admin mode is off.');
}

/** Small "Admin" chip for the header while this session is elevated (or signed in as the administrator).
 *  0.7.1 t2117u: on a real phone (html.handset) an elevated chip is tappable and offers Leave admin mode. A narrow PC window is unchanged. */
export function adminChip(S) {
  const chip = h('span', { class: 'chip adminchip', title: 'Admin mode: administrator actions are unlocked. File > Leave admin mode switches back.', hidden: true }, 'Admin');
  const handset = () => typeof document !== 'undefined' && !!document.documentElement?.classList?.contains('handset');
  const tappable = () => handset() && !!S.auth?.elevated;
  const draw = () => {
    chip.hidden = !(S.auth?.role === 'admin');
    chip.classList.toggle('elev', !!S.auth?.elevated);
    const tap = tappable();
    chip.classList.toggle('adminchip-tap', tap);
    if (tap) { chip.setAttribute('role', 'button'); chip.setAttribute('tabindex', '0'); chip.title = 'Leave admin mode'; chip.setAttribute('aria-label', 'Leave admin mode'); }
    else { chip.removeAttribute('role'); chip.removeAttribute('tabindex'); chip.removeAttribute('aria-label'); chip.title = 'Admin mode: administrator actions are unlocked. File > Leave admin mode switches back.'; }
  };
  const offerLeave = async ev => {
    if (!tappable()) return;
    ev.preventDefault(); ev.stopPropagation();
    const ok = await ask('Leave admin mode', 'Switch back to your usual access? This browser stays paired and keeps playing.', { ok: 'Leave admin mode', anchor: chip });
    if (ok) await leaveAdmin(S);
  };
  chip.addEventListener('click', offerLeave);
  chip.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') offerLeave(ev); });
  draw(); window.addEventListener('wavwiz:auth', draw);
  return chip;
}
