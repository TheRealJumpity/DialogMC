/* Dialog MC — dialog format constants (types, fields, limits, defaults). No DOM.
 * Source of truth: Minecraft's dialog codecs as documented in SpyglassMC/vanilla-mcdoc and the Minecraft Wiki. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const S = (DMC.schema = {});

  S.dialogTypes = [
    { id: 'notice', label: 'Notice', icon: 'message', desc: 'A message with a single button (OK by default).' },
    { id: 'confirmation', label: 'Confirmation', icon: 'check-square', desc: 'Two buttons: yes and no. No also handles ESC.' },
    { id: 'multi_action', label: 'Multi action', icon: 'grid', desc: 'A grid of any number of buttons, plus an optional exit button.' },
    { id: 'server_links', label: 'Server links', icon: 'link', desc: "Buttons for the links the server provides (empty on vanilla servers)." },
    { id: 'dialog_list', label: 'Dialog list', icon: 'list', desc: 'Buttons that open other dialogs (by id, tag or inline).' },
  ];

  S.commonKeys = ['type', 'title', 'external_title', 'body', 'inputs', 'can_close_with_escape', 'pause', 'after_action'];
  S.typeKeys = {
    notice: ['action'],
    confirmation: ['yes', 'no'],
    multi_action: ['actions', 'columns', 'exit_action'],
    server_links: ['exit_action', 'columns', 'button_width'],
    dialog_list: ['dialogs', 'exit_action', 'columns', 'button_width'],
  };
  S.allowedKeys = (type) => S.commonKeys.concat(S.typeKeys[type] || []);

  S.afterActions = [
    { id: 'close', label: 'Close', desc: 'Close the dialog (default).' },
    { id: 'none', label: 'Stay open', desc: 'Keep the dialog open. Requires "pause" to be off.' },
    { id: 'wait_for_response', label: 'Wait for response', desc: 'Show a "Waiting for Response" screen until the server answers.' },
  ];

  S.defaults = {
    buttonWidth: 150, plainWidth: 200, itemSize: 16, inputWidth: 200, maxLength: 32,
    columns: 2, canCloseWithEscape: true, pause: true, afterAction: 'close', textRows: 4,
    labelFormat: 'options.generic_value',
  };
  S.limits = {
    buttonWidth: [1, 1024], plainWidth: [1, 1024], inputWidth: [1, 1024], itemSize: [1, 256],
    multilineHeight: [1, 512], count: [1, 99],
  };

  S.bodyTypes = [
    { id: 'plain_message', label: 'Text', icon: 'type', desc: 'A block of text. Clickable and hoverable.' },
    { id: 'item', label: 'Item', icon: 'box', desc: 'An item icon with an optional description beside it.' },
  ];

  S.inputTypes = [
    { id: 'text', label: 'Text field', icon: 'type', desc: 'Free text (single or multi line).' },
    { id: 'boolean', label: 'Toggle', icon: 'toggle', desc: 'A checkbox that sends one of two strings.' },
    { id: 'single_option', label: 'Option picker', icon: 'select', desc: 'A button that cycles through fixed options.' },
    { id: 'number_range', label: 'Slider', icon: 'sliders', desc: 'A slider between a start and an end value.' },
  ];

  /** Actions a dialog button can have. `text:true` = also valid as a text-component click_event. */
  S.actionTypes = [
    { id: 'run_command', label: 'Run command', icon: 'terminal', text: true, desc: 'Runs a command as the player. Needs the player to have permission.' },
    { id: 'suggest_command', label: 'Suggest command', icon: 'command', text: true, desc: 'Puts text into the chat box (does not run it).' },
    { id: 'open_url', label: 'Open link', icon: 'external', text: true, desc: 'Opens a web link after a confirmation prompt.' },
    { id: 'copy_to_clipboard', label: 'Copy to clipboard', icon: 'copy', text: true, desc: 'Copies a string to the clipboard.' },
    { id: 'show_dialog', label: 'Open dialog', icon: 'layers', text: true, desc: 'Opens another dialog.' },
    { id: 'custom', label: 'Custom event', icon: 'zap', text: true, desc: 'Sends a custom id (+ payload) to the server. Needs a plugin or mod.' },
    { id: 'dynamic/run_command', label: 'Run command with inputs', icon: 'terminal', text: false, dynamic: true, desc: 'A command template using $(key) for input values.' },
    { id: 'dynamic/custom', label: 'Custom event with inputs', icon: 'zap', text: false, dynamic: true, desc: 'Sends a custom id with all input values. Needs a plugin or mod.' },
    { id: 'change_page', label: 'Change page', icon: 'file', text: true, desc: 'Only works in written books — does nothing in dialogs.' },
  ];
  S.actionById = Object.fromEntries(S.actionTypes.map((a) => [a.id, a]));

  S.hoverActions = [
    { id: 'show_text', label: 'Text tooltip' },
    { id: 'show_item', label: 'Item tooltip' },
    { id: 'show_entity', label: 'Entity tooltip' },
  ];

  S.rarities = ['common', 'uncommon', 'rare', 'epic'];

  /** Strip the minecraft: namespace from a type id. */
  S.bare = (t) => (typeof t === 'string' ? t.replace(/^minecraft:/, '') : t);

  /** A fresh, valid dialog of the given type. */
  S.newDialog = function (type) {
    const base = { type: 'minecraft:' + type, title: 'New dialog' };
    switch (type) {
      case 'notice':
        base.body = [{ type: 'minecraft:plain_message', contents: 'Hello world!' }];
        break;
      case 'confirmation':
        base.body = [{ type: 'minecraft:plain_message', contents: 'Are you sure?' }];
        base.yes = { label: 'Yes' };
        base.no = { label: 'No' };
        break;
      case 'multi_action':
        base.actions = [{ label: 'Option 1' }, { label: 'Option 2' }];
        base.exit_action = { label: { translate: 'gui.back' } };
        break;
      case 'server_links':
        base.exit_action = { label: { translate: 'gui.back' } };
        break;
      case 'dialog_list':
        base.dialogs = [];
        base.exit_action = { label: { translate: 'gui.back' } };
        break;
      default:
        break;
    }
    return base;
  };
})();
