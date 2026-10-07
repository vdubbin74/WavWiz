import { h, api, toast, dialog } from './util.js';
import { canControl } from './ui.js';

export function scenesView(S) {
  const root = h('div');
  async function draw() {
    let scenes = []; try { scenes = await api('/scenes'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const can = canControl(S);
    root.replaceChildren(
      h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Scenes'),
        can ? h('button', { class: 'btn primary', onclick: capture }, 'Capture current') : null,
        can ? h('button', { class: 'btn', onclick: () => edit(null) }, 'New scene') : null),
      h('p', { class: 'dim small' }, 'One tap sets which devices are on and their volumes (Party, Night, …).'),
      scenes.length ? scenes.map(sc => h('div', { class: 'card row wrap' },
        h('div', { class: 'grow' }, h('b', null, sc.name), h('div', { class: 'small dim' }, `${(sc.members || []).length} device(s)`)),
        can ? h('button', { class: 'btn primary', onclick: async () => { try { await api(`/scenes/${sc.id}/apply`, { method: 'POST' }); toast('Scene applied'); } catch (e) { toast(e.message, true); } } }, 'Apply') : null,
        can ? h('button', { class: 'btn', onclick: () => edit(sc) }, 'Edit') : null,
        can ? h('button', { class: 'btn danger', onclick: async () => { try { await api(`/scenes/${sc.id}`, { method: 'DELETE' }); draw(); } catch (e) { toast(e.message, true); } } }, '✕') : null))
        : h('p', { class: 'dim' }, 'No scenes yet.'));
  }
  async function capture() {
    const name = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. Party', value: 'Party' });
    dialog('Capture current volumes', h('div', { class: 'field' }, h('label', null, 'Name'), name),
      [{ text: 'Save', cls: 'primary', onclick: async () => { try { await api('/scenes/capture', { method: 'POST', body: { name: name.value } }); toast('Scene saved'); draw(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
  }
  function edit(sc) {
    const name = h('input', { type: 'text', maxlength: 60, value: sc?.name || '' });
    const members = (S.zones || []).map(z => {
      const existing = (sc?.members || []).find(m => m.deviceId === z.id);
      const en = h('input', { type: 'checkbox', checked: existing ? existing.enabled : z.enabled });
      const vol = h('input', { type: 'number', min: 0, max: 100, value: existing ? existing.volume : z.volume, style: 'width:70px' });
      return { z, en, vol };
    });
    dialog(sc ? 'Edit scene' : 'New scene', [
      h('div', { class: 'field' }, h('label', null, 'Name'), name),
      h('div', null, members.map(({ z, en, vol }) => h('div', { class: 'row' }, en, h('span', { class: 'grow' }, z.name), vol, '%')))
    ], [{ text: 'Save', cls: 'primary', onclick: async () => {
      const body = { name: name.value, members: members.map(({ z, en, vol }) => ({ deviceId: z.id, enabled: en.checked, volume: +vol.value })) };
      try {
        if (sc) await api(`/scenes/${sc.id}`, { method: 'PUT', body }); else await api('/scenes', { method: 'POST', body });
        toast('Saved'); draw();
      } catch (e) { toast(e.message, true); return false; }
    } }, { text: 'Cancel' }]);
  }
  draw(); return { el: root, reload: draw };
}
