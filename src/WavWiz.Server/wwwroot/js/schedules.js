import { h, api, toast, dialog } from './util.js';
import { canControl } from './ui.js';

const ACTIONS = [['all_off', 'Stop everything'], ['play_radio', 'Play a radio station'], ['scene', 'Apply a scene'], ['stop', 'Stop playback']];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function schedulesView(S) {
  const root = h('div');
  async function draw() {
    let rows = []; try { rows = await api('/schedules'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const can = canControl(S);
    root.replaceChildren(
      h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Schedules'), can ? h('button', { class: 'btn primary', onclick: () => edit(null) }, 'Add') : null),
      h('p', { class: 'dim small' }, 'e.g. radio in the kitchen at 7:00, everything off at midnight. Times use this server PC\'s clock.'),
      rows.length ? rows.map(r => h('div', { class: 'card row wrap' },
        h('div', { class: 'grow' }, h('b', null, r.name), h('div', { class: 'small dim' }, `${r.time} • ${[...r.days].map(d => DAYS[+d] || d).join(' ')} • ${r.action}${r.enabled ? '' : ' (off)'}`)),
        can ? h('button', { class: 'btn', onclick: async () => { try { await api(`/schedules/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); draw(); } catch (e) { toast(e.message, true); } } }, r.enabled ? 'Disable' : 'Enable') : null,
        can ? h('button', { class: 'btn', onclick: () => edit(r) }, 'Edit') : null,
        can ? h('button', { class: 'btn danger', onclick: async () => { try { await api(`/schedules/${r.id}`, { method: 'DELETE' }); draw(); } catch (e) { toast(e.message, true); } } }, '✕') : null))
        : h('p', { class: 'dim' }, 'No schedules yet.'));
  }
  async function edit(r) {
    let scenes = [], radio = []; try { [scenes, radio] = await Promise.all([api('/scenes'), api('/radio')]); } catch { /* optional */ }
    const name = h('input', { type: 'text', maxlength: 60, value: r?.name || '' });
    const time = h('input', { type: 'time', value: r?.time || '07:00' });
    const action = h('select', null, ACTIONS.map(([v, t]) => h('option', { value: v, selected: (r?.action || 'all_off') === v }, t)));
    const dayChecks = DAYS.map((d, i) => ({ i, el: h('input', { type: 'checkbox', checked: !r || (r.days || '').includes(String(i)) }) }));
    const radioSel = h('select', null, radio.map(x => h('option', { value: x.id, selected: r?.payload?.radioId == x.id }, x.name)));
    const sceneSel = h('select', null, scenes.map(x => h('option', { value: x.id, selected: r?.payload?.sceneId == x.id }, x.name)));
    dialog(r ? 'Edit schedule' : 'New schedule', [
      h('div', { class: 'field' }, h('label', null, 'Name'), name),
      h('div', { class: 'field' }, h('label', null, 'Time'), time),
      h('div', { class: 'field' }, h('label', null, 'Action'), action),
      h('div', { class: 'field' }, h('label', null, 'Days'), h('div', { class: 'row wrap' }, ...dayChecks.map(({ i, el }) => h('label', { class: 'row' }, el, DAYS[i])))),
      h('div', { class: 'field' }, h('label', null, 'Radio station (for Play radio)'), radioSel),
      h('div', { class: 'field' }, h('label', null, 'Scene (for Apply scene)'), sceneSel),
    ], [{ text: 'Save', cls: 'primary', onclick: async () => {
      const days = dayChecks.filter(d => d.el.checked).map(d => String(d.i)).join('') || '0123456';
      const body = { name: name.value, time: time.value, action: action.value, days, payload: { radioId: +radioSel.value || undefined, sceneId: +sceneSel.value || undefined } };
      try { if (r) await api(`/schedules/${r.id}`, { method: 'PUT', body }); else await api('/schedules', { method: 'POST', body }); toast('Saved'); draw(); }
      catch (e) { toast(e.message, true); return false; }
    } }, { text: 'Cancel' }]);
  }
  draw(); return { el: root, reload: draw };
}
