/* Dialog MC — starter templates and the gallery modal. Every template is built for the project's namespace
 * so show_dialog links between the dialogs it adds already point at each other. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const T = (DMC.templates = {});
  const M = (id) => 'minecraft:' + id;
  const msg = (contents, width) => Object.assign({ type: M('plain_message'), contents }, width ? { width } : {});
  const back = () => ({ label: { translate: 'gui.back' } });
  const tags = (o) => Object.assign({ pause: false, quick: false, extra: [] }, o || {});

  /** Each template: {id, name, icon, desc, note?, build(ns) -> [{id, dialog, tags}]} */
  T.list = [
    {
      id: 'welcome', name: 'Welcome notice', icon: 'message',
      desc: 'A friendly message with one button. Good for the first time a player joins.',
      build: () => [{
        id: 'welcome',
        dialog: {
          type: M('notice'),
          title: { text: 'Welcome!', color: 'gold', bold: true },
          body: [
            msg([{ text: 'Glad you’re here. ', color: 'white' }, { text: 'Take a look around, build something, and say hi in chat.', color: 'gray' }], 220),
          ],
          action: { label: { text: 'Let’s go', color: 'green' }, width: 120 },
        },
        tags: tags(),
      }],
    },
    {
      id: 'rules', name: 'Rules with agree button', icon: 'check-square',
      desc: 'Players read the rules and press Agree. Agree sets a trigger score you can react to in a function.',
      note: 'One-time setup in the world: /scoreboard objectives add rules_accepted trigger, then /scoreboard players enable @a rules_accepted. It needs no operator permission.',
      build: () => [{
        id: 'rules',
        dialog: {
          type: M('confirmation'),
          title: { text: 'Server rules', color: 'red' },
          can_close_with_escape: false,
          body: [
            msg([
              { text: '1. ', color: 'gold' }, { text: 'Be kind to other players.\n' },
              { text: '2. ', color: 'gold' }, { text: 'No griefing or stealing.\n' },
              { text: '3. ', color: 'gold' }, { text: 'Ask before you build near someone.' },
            ], 240),
          ],
          yes: { label: { text: 'I agree', color: 'green' }, tooltip: 'Marks the rules as accepted', action: { type: M('run_command'), command: 'trigger rules_accepted set 1' } },
          no: { label: { text: 'Leave', color: 'red' }, action: { type: M('run_command'), command: 'trigger rules_accepted set 2' } },
        },
        tags: tags(),
      }],
    },
    {
      id: 'give', name: 'Give items form', icon: 'sliders',
      desc: 'Inputs for player, item and amount, then /give with the values filled in. Shows how $(key) works.',
      note: '/give needs operator permission, so only operators can use this one. The Problems tab says so.',
      build: () => [{
        id: 'give_items',
        dialog: {
          type: M('confirmation'),
          title: 'Give items',
          body: [msg('Choose who gets what.', 220)],
          inputs: [
            { type: M('text'), key: 'player', label: 'Player', width: 220, initial: '@s', max_length: 40 },
            { type: M('text'), key: 'item', label: 'Item', width: 220, initial: 'minecraft:diamond', max_length: 60 },
            { type: M('number_range'), key: 'amount', label: 'Amount', width: 220, start: 1, end: 64, step: 1, initial: 1 },
          ],
          yes: { label: { text: 'Give', color: 'green' }, action: { type: M('dynamic/run_command'), template: 'give $(player) $(item) $(amount)' } },
          no: { label: 'Cancel' },
        },
        tags: tags(),
      }],
    },
    {
      id: 'feedback', name: 'Feedback form', icon: 'type',
      desc: 'A rating, a short comment and a toggle, sent together as one custom event.',
      note: 'Chat commands that carry typed text (/me, /msg) can’t run from a click, so this button sends the custom event my_pack:feedback with every value. A plugin or mod on your server receives it.',
      build: (ns) => [{
        id: 'feedback',
        dialog: {
          type: M('confirmation'),
          title: 'Send feedback',
          body: [msg('Tell us how it’s going.', 220)],
          inputs: [
            { type: M('single_option'), key: 'rating', label: 'How is it?', width: 220, options: [{ id: '5 stars', display: 'Great' }, { id: '4 stars', display: 'Good', initial: true }, { id: '3 stars', display: 'Okay' }, { id: '2 stars', display: 'Poor' }, { id: '1 star', display: 'Bad' }] },
            { type: M('text'), key: 'comment', label: 'Comment', width: 220, initial: '', max_length: 120 },
            { type: M('boolean'), key: 'again', label: 'I’d play again', initial: true, on_true: 'would play again', on_false: 'might not return' },
          ],
          yes: { label: { text: 'Send', color: 'green' }, action: { type: M('dynamic/custom'), id: ns + ':feedback' } },
          no: { label: 'Not now' },
        },
        tags: tags(),
      }],
    },
    {
      id: 'kits', name: 'Kit chooser', icon: 'box',
      desc: 'Items with a description beside them and one button per kit. Each button sets a trigger a function can answer.',
      note: 'Setup: /scoreboard objectives add kit trigger, /scoreboard players enable @a kit. Then check "kit" scores 1 or 2 in a tick function.',
      build: () => [{
        id: 'kits',
        dialog: {
          type: M('multi_action'),
          title: { text: 'Choose a kit', color: 'aqua' },
          columns: 2,
          body: [
            { type: M('item'), item: { id: M('iron_sword'), count: 1 }, description: { contents: [{ text: 'Warrior\n', color: 'red', bold: true }, { text: 'Sword, shield and armor', color: 'gray' }], width: 150 } },
            { type: M('item'), item: { id: M('bow'), count: 1 }, description: { contents: [{ text: 'Archer\n', color: 'green', bold: true }, { text: 'Bow, arrows and leather armor', color: 'gray' }], width: 150 } },
          ],
          actions: [
            { label: { text: 'Warrior', color: 'red' }, tooltip: 'Pick the warrior kit', width: 120, action: { type: M('run_command'), command: 'trigger kit set 1' } },
            { label: { text: 'Archer', color: 'green' }, tooltip: 'Pick the archer kit', width: 120, action: { type: M('run_command'), command: 'trigger kit set 2' } },
          ],
          exit_action: { label: 'Close' },
        },
        tags: tags(),
      }],
    },
    {
      id: 'menu', name: 'Server menu pack', icon: 'layers', bundle: true,
      desc: 'A main menu that links to rules, a star rating and a help list — four dialogs that already point at each other. Opens from the quick actions key.',
      note: 'The rating uses a trigger: /scoreboard objectives add feedback trigger, then /scoreboard players enable @a feedback.',
      build: (ns) => [
        {
          id: 'menu',
          dialog: {
            type: M('multi_action'),
            title: { text: 'Main menu', color: 'gold', bold: true },
            columns: 2,
            body: [msg('What would you like to do?', 260)],
            actions: [
              { label: 'Rules', tooltip: 'Read the server rules', width: 120, action: { type: M('show_dialog'), dialog: ns + ':menu_rules' } },
              { label: 'Feedback', tooltip: 'Tell us what you think', width: 120, action: { type: M('show_dialog'), dialog: ns + ':menu_feedback' } },
              { label: 'Help', tooltip: 'Find answers', width: 120, action: { type: M('show_dialog'), dialog: ns + ':menu_help' } },
              { label: 'Website', tooltip: 'Opens in your browser', width: 120, action: { type: M('open_url'), url: 'https://www.minecraft.net' } },
              { label: 'Copy address', tooltip: 'Copies the server address', width: 120, action: { type: M('copy_to_clipboard'), value: 'play.example.net' } },
            ],
            exit_action: { label: 'Close' },
          },
          tags: tags({ quick: true }),
        },
        {
          id: 'menu_rules',
          dialog: {
            type: M('notice'),
            title: 'Rules',
            body: [msg('Be kind. No griefing. Ask before building near others.', 240)],
            action: { label: { translate: 'gui.back' }, action: { type: M('show_dialog'), dialog: ns + ':menu' } },
          },
          tags: tags(),
        },
        {
          id: 'menu_feedback',
          dialog: {
            type: M('confirmation'),
            title: 'Feedback',
            body: [msg('How are you finding the server?', 240)],
            inputs: [{ type: M('number_range'), key: 'stars', label: 'Stars', width: 240, start: 1, end: 5, step: 1, initial: 4 }],
            yes: { label: { text: 'Send', color: 'green' }, action: { type: M('dynamic/run_command'), template: 'trigger feedback set $(stars)' } },
            no: { label: { translate: 'gui.back' }, action: { type: M('show_dialog'), dialog: ns + ':menu' } },
          },
          tags: tags(),
        },
        {
          id: 'menu_help',
          dialog: {
            type: M('dialog_list'),
            title: 'Help',
            columns: 1,
            button_width: 200,
            dialogs: [ns + ':menu_rules', ns + ':menu_feedback'],
            exit_action: { label: { translate: 'gui.back' }, action: { type: M('show_dialog'), dialog: ns + ':menu' } },
          },
          tags: tags(),
        },
      ],
    },
    {
      id: 'links', name: 'Server links', icon: 'link',
      desc: 'Shows the links a server publishes (website, forum, report a bug). Empty on servers that set none.',
      build: () => [{
        id: 'links',
        dialog: { type: M('server_links'), title: 'Links', columns: 2, button_width: 150, exit_action: back() },
        tags: tags(),
      }],
    },
    {
      id: 'blank', name: 'Blank notice', icon: 'file',
      desc: 'Start from the smallest valid dialog.',
      build: () => [{ id: 'blank', dialog: DMC.schema.newDialog('notice'), tags: tags() }],
    },
  ];
  T.byId = Object.fromEntries(T.list.map((t) => [t.id, t]));

  T.entries = (t) => t.build(St.project().pack.namespace);
  T.add = function (t) {
    const first = St.addMany(T.entries(t).map((e) => ({ id: e.id, dialog: DMC.editor.normalize(e.dialog, 0), tags: e.tags })), { reason: 'template' });
    F.toast(t.bundle ? U.plural(T.entries(t).length, 'dialog') + ' added' : '“' + t.name + '” added', { kind: 'ok', action: { label: 'Undo', onClick: () => St.undo() } });
    return first;
  };
  T.replace = function (t) {
    const entries = T.entries(t).map((e) => ({ id: e.id, dialog: DMC.editor.normalize(e.dialog, 0), tags: e.tags }));
    const p = St.project();
    St.replaceProject({ pack: p.pack, dialogs: entries }, { version: p.version });
  };

  /** A rough structural sketch of the first dialog, so cards look different from each other. */
  function sketch(t) {
    const d = T.entries(t)[0].dialog;
    const type = DMC.schema.bare(d.type);
    const rows = [];
    rows.push(h('i', { class: 'sk-title' }));
    for (const b of d.body || []) rows.push(h('i', { class: b.type === M('item') ? 'sk-item' : 'sk-text' }));
    for (const _ of d.inputs || []) rows.push(h('i', { class: 'sk-input' }));
    let btns = 0;
    if (type === 'confirmation') btns = 2; else if (type === 'notice') btns = 1;
    else if (type === 'multi_action') btns = (d.actions || []).length; else if (type === 'dialog_list') btns = 2; else btns = 2;
    const cols = type === 'confirmation' ? 2 : d.columns || 1;
    const grid = h('div', { class: 'sk-btns', style: 'grid-template-columns:repeat(' + Math.min(cols, 3) + ',1fr)' });
    for (let i = 0; i < Math.min(btns, 6); i++) grid.appendChild(h('i', { class: 'sk-btn' }));
    rows.push(grid);
    return h('div', { class: 'sketch', 'aria-hidden': 'true' }, rows);
  }

  T.open = function () {
    const grid = h('div', { class: 'tpl-grid' });
    let m;
    for (const t of T.list) {
      const types = [...new Set(T.entries(t).map((e) => DMC.schema.bare(e.dialog.type)))];
      const card = h('div', { class: 'tpl' },
        sketch(t),
        h('div', { class: 'tpl-b' },
          h('div', { class: 'tpl-t' }, U.icon(t.icon, 15), t.name),
          h('div', { class: 'hint' }, t.desc),
          t.note ? h('div', { class: 'hint note' }, t.note) : null,
          h('div', { class: 'cluster', style: 'gap:6px;margin-top:auto' },
            h('button', { type: 'button', class: 'btn sm primary', onclick: () => { T.add(t); m.close(); } }, U.icon('check', 14), 'Add to project'),
            h('button', { type: 'button', class: 'btn sm ghost', title: 'Replace everything with this', onclick: async () => {
              const ok = await F.confirm({ title: 'Start over with “' + t.name + '”?', text: 'This replaces all ' + St.project().dialogs.length + ' dialog(s) in the project. You can undo it.', ok: 'Replace', danger: true });
              if (ok) { T.replace(t); m.close(); }
            } }, 'Start over with it'),
            h('span', { class: 'grow' }),
            h('span', { class: 'hint mono' }, types.join(', '))))
      );
      grid.appendChild(card);
    }
    m = F.modal({ title: 'Templates', wide: true, body: grid });
    return m;
  };
})();
