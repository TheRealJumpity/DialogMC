'use strict';
const assert = require('assert');
const DMC = require('./load')('data-registry.js', 'data-commands.js', 'data-lang.js', 'util.js', 'snbt.js', 'versions.js', 'text.js', 'commands.js');
const C = DMC.cmd;
let n = 0, failed = 0;
function ok(cmd, ver = '26.2', extra) {
  const r = C.validate(cmd, ver);
  try { assert.ok(r.ok, `expected VALID: ${cmd}  -> ${r.errors.map(e => e.message + '@' + e.pos).join('; ')}`); if (extra) extra(r); n++; }
  catch (e) { failed++; console.error('FAIL', e.message); process.exitCode = 1; }
}
function bad(cmd, ver = '26.2', re) {
  const r = C.validate(cmd, ver);
  try {
    assert.ok(!r.ok, `expected INVALID: ${cmd}`);
    if (re) assert.ok(re.test(r.errors[0].message), `message for "${cmd}" was: ${r.errors[0].message}`);
    n++;
  } catch (e) { failed++; console.error('FAIL', e.message); process.exitCode = 1; }
}

// --- valid commands
ok('say hello world');
ok('/say hello world');
ok('give @s diamond');
ok('give @s minecraft:diamond 5');
ok('give @a diamond_sword[minecraft:custom_name="Hi",minecraft:damage=3] 1');
ok('give @p[distance=..5,limit=1,sort=nearest] stone 64');
ok('tp @s ~ ~1 ~');
ok('tp @s 0 64 0');
ok('tp @a ^ ^ ^5');
ok('function mypack:menu/open');
ok('trigger menu_open');
ok('trigger menu_open set 1');
ok('scoreboard players add @s points 1');
ok('scoreboard players set @a[team=red] kills 0');
ok('execute as @a at @s run say hi');
ok('execute as @a[scores={a=1..}] at @s if block ~ ~-1 ~ stone run function a:b');
ok('execute if score @s a matches 1.. run tellraw @a {"text":"hi"}');
ok('tellraw @a {"text":"hi","color":"red"}');
ok('tellraw @a ["",{"text":"a"},"b"]');
ok('title @a title {"text":"Hello"}');
ok('effect give @s speed 30 1 true');
ok('gamemode creative');
ok('gamemode survival @a');
ok('time set day');
ok('weather clear');
ok('kill @e[type=zombie,distance=..10]');
ok('data get entity @s Health');
ok('data modify storage a:b x set value {a:1}');
ok('data merge entity @s {NoAI:1b}');
ok('summon zombie ~ ~ ~ {CustomName:\'"x"\'}');
ok('setblock ~ ~ ~ stone');
ok('setblock ~ ~ ~ minecraft:oak_stairs[facing=north,half=top]');
ok('fill ~ ~ ~ ~5 ~5 ~5 air replace stone');
ok('clear @s diamond 3');
ok('xp add @s 5 levels');
ok('playsound minecraft:entity.experience_orb.pickup master @a');
ok('particle minecraft:flame ~ ~ ~ 0 0 0 0 1 force');
ok('dialog show @s mypack:main');
ok('dialog show @s minecraft:custom_options');
ok('dialog show @a {type:"minecraft:notice",title:"Hi"}');
ok('dialog clear @s');
ok('team modify red color red');
ok('bossbar set mybar visible true');
ok('gamerule keep_inventory true', '26.2');
ok('enchant @s sharpness 3');
ok('item replace entity @s weapon.mainhand with diamond_sword');
ok('msg Steve hello');
ok('trigger a add 1');
ok('attribute @s minecraft:max_health base set 40');
ok('execute store result score @s a run data get entity @s Health');
ok('summon minecraft:sulfur_cube ~ ~ ~', '26.2');

// --- invalid commands
bad('', '26.2', /empty/);
bad('gve @s diamond', '26.2', /Unknown command 'gve'.*give/);
bad('give @s', '26.2', /Incomplete/);
bad('give @s diamond x', '26.2', /integer|Invalid|Expected/i);
bad('give @s notanitem', '26.2', /Unknown item/);
bad('give @s diamond 0', '26.2', /less than 1/);
bad('give @s diamond ', '26.2', /trailing space/);
bad('tp @s ~ ~ ', '26.2');
bad('execute as @a run', '26.2');
bad('effect give @s speed 30 300', '26.2', /more than 255/);
bad('dialog show @e mypack:main', '26.2', /Only players/);
bad('dialog show @s', '26.2', /Incomplete/);
bad('gamemode flying', '26.2');
bad('kill @e[typ=zombie]', '26.2', /Unknown selector option 'typ'.*type/);
bad('kill @e[type=nope]', '26.2', /Unknown entity type/);
bad('kill @x', '26.2', /Unknown selector type/);
bad('tellraw @a {"text":"hi"', '26.2');
bad('tellraw @a {text:}', '26.2');
bad('scoreboard players set @s a', '26.2');
bad('give @s diamond[minecraft:nope=1]', '26.2', /Unknown data component/);
bad('give @s diamond{display:{Name:"x"}}', '26.2', /components/);
bad('give @s cinnabar', '1.21.11', /doesn't exist in 1\.21\.11/);
bad('team modify red color Red', '26.2');
bad('tp @s ~ ^ ~', '26.2', /mix/);
bad('setblock ~ ~ ~', '26.2');
bad('foo', '26.2', /Unknown command/);
bad('say §chi', '26.2', /§/);
bad('say a\nb', '26.2', /line break/);

// --- permission levels / signed flags
ok('say hi', '26.2', r => assert.ok(r.signed, 'say should be signed'));
ok('msg Steve hi', '26.2', r => { assert.ok(r.signed); assert.strictEqual(r.level, 0); });
ok('me waves', '26.2', r => assert.ok(r.signed));
ok('teammsg hello', '26.2', r => assert.ok(r.signed));
ok('trigger a', '26.2', r => { assert.ok(!r.signed); assert.strictEqual(r.level, 0); });
ok('give @s diamond', '26.2', r => assert.strictEqual(r.level, 2));
ok('execute as @a run say hi', '26.2', r => { assert.ok(r.signed); assert.strictEqual(r.level, 2); });
ok('op Steve', '26.2', r => assert.strictEqual(r.level, 3));
ok('stop', '26.2', r => assert.strictEqual(r.level, 4));
ok('tellraw @a "x"', '26.2', r => assert.strictEqual(r.level, 2));
ok('function a:b', '26.2', r => assert.strictEqual(r.level, 2));

// templates
assert.deepStrictEqual(C.templateKeys('say $(a) and $(b_2)'), ['a', 'b_2']);
assert.strictEqual(C.expand('give @s diamond $(n)', { n: 5 }), 'give @s diamond 5');
assert.strictEqual(C.escapeInput('a"b\'c\\'), 'a\\"b\\\'c\\\\');
n += 3;

console.log(`command tests passed: ${n}, failed: ${failed}`);
