/* Loads the browser scripts into Node for testing: window === global. */
'use strict';
const path = require('path');
global.window = global;
const root = path.join(__dirname, '..', 'js');
const loaded = new Set();
module.exports = function load(...files) {
  for (const f of files) {
    if (loaded.has(f)) continue;
    loaded.add(f);
    require(path.join(root, f));
  }
  return global.DMC;
};
