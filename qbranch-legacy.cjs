#!/usr/bin/env node
'use strict';
/**
 * 007 Q-Branch Legacy-Compatible All-in-One Hub & Autonomous Coding Agent
 * 100% compatible with Node.js v10.24.1+ (OS X 10.7 Lion / 10.8 Mountain Lion through macOS 15+)
 * Zero external npm dependencies; uses built-in OpenSSL 1.1.1 (TLS 1.2/1.3) via https.request.
 */
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var urlMod = require('url');
var readline = require('readline');
var childProcess = require('child_process');

var SCRIPT_DIR = __dirname;
var USER_HOME = os.homedir();
var IS_WIN = process.platform === 'win32';

var C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[1;36m',
  gold: '\x1b[1;33m',
  green: '\x1b[1;32m',
  red: '\x1b[1;31m',
  magenta: '\x1b[1;35m',
  white: '\x1b[1;37m',
  gray: '\x1b[90m'
};

var rl = null;
function getRl() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY)
    });
    rl.on('close', function () {
      rl = null;
    });
  }
  return rl;
}

function closeRl() {
  if (rl) {
    try { rl.close(); } catch (e) {}
    rl = null;
  }
}

function ask(query) {
  return new Promise(function (resolve) {
    var iface = getRl();
    var settled = false;
    function done(val) {
      if (!settled) {
        settled = true;
        resolve(typeof val === 'string' ? val.trim() : '');
      }
    }
    iface.question(query, done);
    iface.once('close', function () { done(''); });
  });
}

function mkdirp(dir) {
  if (!dir) return;
  if (fs.existsSync(dir)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    mkdirp(path.dirname(dir));
    try { fs.mkdirSync(dir); } catch (e2) {}
  }
}

function copyDirSync(src, dst) {
  if (!fs.existsSync(src)) return;
  mkdirp(dst);
  var items = fs.readdirSync(src);
  for (var i = 0; i < items.length; i++) {
    var name = items[i];
    var s = path.join(src, name);
    var d = path.join(dst, name);
    try {
      var st = fs.statSync(s);
      if (st.isDirectory()) copyDirSync(s, d);
      else fs.copyFileSync(s, d);
    } catch (e) {}
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return fallback !== undefined ? fallback : {};
}

function writeJsonSafe(filePath, data) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getSettingsPath() {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
  }
  if (process.env.QBRANCH_MAC_HOME) {
    return path.join(process.env.QBRANCH_MAC_HOME, 'config', 'claude', 'settings.json');
  }
  return path.join(USER_HOME, '.claude', 'settings.json');
}

function readSettings() {
  var candidates = [
    getSettingsPath(),
    path.join(USER_HOME, '.claude', 'settings.json'),
    path.join(SCRIPT_DIR, 'config', 'claude', 'settings.json')
  ];
  for (var i = 0; i < candidates.length; i++) {
    var p = candidates[i];
    if (p && fs.existsSync(p)) {
      var s = readJsonSafe(p, null);
      if (s && s.env) return s;
    }
  }
  return { env: {}, permissions: {}, modelSettings: {} };
}

function saveSettings(settings) {
  var target = getSettingsPath();
  writeJsonSafe(target, settings);
}

function getConfigSummary() {
  var s = readSettings();
  var env = s.env || {};
  var rawBase = process.env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  var baseOrigin = rawBase.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  var apiKey = process.env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN || env.TYPESAFE_API_KEY || '';
  var primary = env.ANTHROPIC_MODEL || 'gpt-6-luna';
  var fast = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  return { settings: s, baseOrigin: baseOrigin, apiKey: apiKey, primary: primary, fast: fast };
}

function maskKey(k) {
  if (!k) return '(not set)';
  if (k.length < 12) return '***';
  return k.slice(0, 7) + '...' + k.slice(-4);
}

/**
 * Load optional extra CA bundle if bundled on USB or ~/Q-Branch-Mac (handles roots added after 2021 on Node 10).
 */
var EXTRA_CA = null;
function getExtraCa() {
  if (EXTRA_CA !== null) return EXTRA_CA;
  var candidates = [
    process.env.QBRANCH_CA_BUNDLE,
    process.env.QBRANCH_MAC_HOME ? path.join(process.env.QBRANCH_MAC_HOME, 'runtime', 'cacert.pem') : null,
    process.env.USB_ROOT ? path.join(process.env.USB_ROOT, 'runtime', 'mac', 'cacert.pem') : null,
    path.join(SCRIPT_DIR, 'runtime', 'mac', 'cacert.pem')
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(candidates[i])) {
      try {
        EXTRA_CA = fs.readFileSync(candidates[i], 'utf8');
        return EXTRA_CA;
      } catch (e) {}
    }
  }
  EXTRA_CA = '';
  return EXTRA_CA;
}

/**
 * Node-10-native HTTP/HTTPS request helper supporting TLS 1.3 via bundled OpenSSL 1.1.1,
 * gzip/deflate decoding, and automatic redirect following (unless followRedirects === false).
 */
function httpRequest(targetUrl, opts, depth) {
  opts = opts || {};
  depth = depth || 0;
  return new Promise(function (resolve, reject) {
    var parsed = urlMod.parse(targetUrl);
    var isHttps = parsed.protocol === 'https:';
    var mod = isHttps ? https : http;
    var method = opts.method || 'GET';
    var headers = { 'Accept-Encoding': 'gzip, deflate' };
    if (opts.headers) {
      var hKeys = Object.keys(opts.headers);
      for (var i = 0; i < hKeys.length; i++) headers[hKeys[i]] = opts.headers[hKeys[i]];
    }
    var bodyStr = null;
    if (opts.body !== undefined && opts.body !== null) {
      bodyStr = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      if (!headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
      }
    }
    var reqOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path || '/',
      method: method,
      headers: headers
    };
    if (isHttps) {
      var ca = getExtraCa();
      if (ca) reqOpts.ca = ca;
    }

    var t0 = Date.now();
    var req = mod.request(reqOpts, function (res) {
      var code = res.statusCode || 0;
      if (opts.followRedirects !== false && depth < 5 && (code === 301 || code === 302 || code === 307 || code === 308) && res.headers.location) {
        res.resume();
        var nextUrl = urlMod.resolve(targetUrl, res.headers.location);
        httpRequest(nextUrl, opts, depth + 1).then(resolve, reject);
        return;
      }
      var stream = res;
      var enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());

      var chunks = [];
      var totalLen = 0;
      var maxBytes = opts.maxBytes || 16 * 1024 * 1024;
      stream.on('data', function (chunk) {
        if (totalLen < maxBytes) {
          chunks.push(chunk);
          totalLen += chunk.length;
        }
      });
      stream.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: code,
          statusText: res.statusMessage || '',
          headers: res.headers || {},
          text: text,
          elapsedMs: Date.now() - t0
        });
      });
      stream.on('error', function (err) { reject(err); });
    });

    req.setTimeout(opts.timeoutMs || 30000, function () {
      req.abort();
      reject(new Error('Request timed out'));
    });
    req.on('error', function (err) {
      reject(err);
    });
    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

function getSkillDirs() {
  var dirs = [
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills') : null,
    process.env.HERMES_HOME ? path.join(process.env.HERMES_HOME, 'skills', 'vault') : null,
    process.env.QBRANCH_MAC_HOME ? path.join(process.env.QBRANCH_MAC_HOME, 'skills') : null,
    path.join(SCRIPT_DIR, 'skills'),
    path.join(USER_HOME, '.claude', 'skills')
  ];
  var out = [];
  for (var i = 0; i < dirs.length; i++) {
    if (dirs[i] && fs.existsSync(dirs[i])) out.push(dirs[i]);
  }
  return out;
}

function listAvailableSkills() {
  var map = {};
  var dirs = getSkillDirs();
  for (var i = 0; i < dirs.length; i++) {
    try {
      var entries = fs.readdirSync(dirs[i]);
      for (var j = 0; j < entries.length; j++) {
        var name = entries[j];
        var md = path.join(dirs[i], name, 'SKILL.md');
        if (fs.existsSync(md) && !map[name]) {
          map[name] = { dir: path.join(dirs[i], name), md: md };
        }
      }
    } catch (e) {}
  }
  return map;
}

function padEnd(str, len) {
  str = String(str || '');
  while (str.length < len) str += ' ';
  return str;
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// ============================================================================
// 1. ENV-SUMMARY & STATUS
// ============================================================================
function printEnvSummary() {
  var cfg = getConfigSummary();
  var jevStatus = cfg.apiKey ? 'ACTIVE' : 'NO KEY';
  console.log('Q_PRIMARY=' + cfg.primary);
  console.log('Q_FAST=' + cfg.fast);
  console.log('Q_JEV_STATUS=' + jevStatus);
  console.log('Q_JEV_GATE=OFF');
}

function showStatus() {
  var cfg = getConfigSummary();
  var skills = listAvailableSkills();
  var skillCount = Object.keys(skills).length;
  console.log('');
  console.log(C.cyan + '============================================================================' + C.reset);
  console.log(C.gold + '  007 Q-BRANCH : AGENT INTELLIGENCE HUB (LEGACY / NODE ' + process.version + ')' + C.reset);
  console.log(C.cyan + '============================================================================' + C.reset);
  console.log('  Gateway Base URL   : ' + C.cyan + cfg.baseOrigin + C.reset);
  console.log('  API Key            : ' + C.green + maskKey(cfg.apiKey) + C.reset);
  console.log('  Primary Model      : ' + C.gold + cfg.primary + C.reset);
  console.log('  Fast Aux Model     : ' + C.cyan + cfg.fast + C.reset);
  console.log('  Jev System-1 API   : ' + (cfg.apiKey ? C.green + 'READY (/v1/systemone)' : C.red + 'MISSING KEY') + C.reset);
  console.log('  Skills Available   : ' + C.magenta + skillCount + ' skills loaded' + C.reset);
  console.log(C.cyan + '----------------------------------------------------------------------------' + C.reset);
}

// ============================================================================
// 2. ONLINE MODEL BROWSER ([M] - Zero-Cost + Discounted Models Only)
// ============================================================================
function applyModelPair(primaryModel, fastModel) {
  var cfg = getConfigSummary();
  var s = cfg.settings;
  s.env = s.env || {};
  s.env.ANTHROPIC_MODEL = primaryModel;
  s.env.ANTHROPIC_DEFAULT_SONNET_MODEL = primaryModel;
  s.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = primaryModel;
  s.env.ANTHROPIC_DEFAULT_OPUS_MODEL = primaryModel;
  s.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = primaryModel;
  s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = fastModel;
  s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = fastModel;
  s.env.ANTHROPIC_SMALL_FAST_MODEL = fastModel;
  s.env.CLAUDE_CODE_SUBAGENT_MODEL = fastModel;
  saveSettings(s);
}

function fmtPrice(v) {
  var n = Number(v);
  if (!isFinite(n)) return '0';
  if (n === 0) return '0';
  if (n >= 1) return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
  return n.toFixed(3).replace(/0$/, '');
}

async function fetchLegacyCatalog(baseOrigin, apiKey) {
  var headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  var models = [];
  var promotions = [];
  var offset = 0;
  while (true) {
    var res = await httpRequest(baseOrigin + '/api/models?limit=1000&offset=' + offset, { headers: headers, timeoutMs: 20000 });
    if (res.status !== 200) {
      if (offset === 0 && (res.status === 404 || res.status === 405)) return null;
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }
    var json = JSON.parse(res.text);
    if (!Array.isArray(json.models)) return null;
    for (var i = 0; i < json.models.length; i++) models.push(json.models[i]);
    if (offset === 0 && Array.isArray(json.promotions)) promotions = json.promotions;
    if (models.length >= (json.total || 0) || json.models.length === 0) break;
    offset += json.models.length;
  }
  return { models: models, promotions: promotions };
}

async function browseModels() {
  var cfg = getConfigSummary();
  console.log('\n' + C.gold + '=== Q-BRANCH : LIVE ONLINE MODEL BROWSER ===' + C.reset);
  console.log(C.gray + 'Fetching live catalog & discounts from ' + cfg.baseOrigin + '...' + C.reset + '\n');

  var headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;

  var catalog = null;
  try {
    catalog = await fetchLegacyCatalog(cfg.baseOrigin, cfg.apiKey);
  } catch (e) {
    console.log(C.red + 'X Failed to fetch model catalog: ' + e.message + C.reset);
    return;
  }

  try {
    if (cfg.apiKey) {
      var cRes = await httpRequest(cfg.baseOrigin + '/api/v1/credits', { headers: headers, timeoutMs: 8000 });
      if (cRes.status === 200) {
        var cJson = JSON.parse(cRes.text);
        if (cJson && cJson.data) {
          var tot = cJson.data.total_credits || 0;
          var used = cJson.data.total_usage || 0;
          var rem = Math.max(0, tot - used);
          console.log('  ' + C.gray + 'Credits Remaining:' + C.reset + ' ' + C.green + '$' + rem.toFixed(2) + C.reset + C.gray + ' / $' + tot.toFixed(2) + C.reset + '\n');
        }
      }
    }
  } catch (e) {}

  var freeList = [];
  var discountList = [];
  if (catalog) {
    var promoBySlug = {};
    for (var pi = 0; pi < catalog.promotions.length; pi++) {
      var pr = catalog.promotions[pi];
      var slugs = pr.slugs || [];
      for (var si = 0; si < slugs.length; si++) {
        var sl = slugs[si];
        var prev = promoBySlug[sl];
        if (!prev || pr.free || (pr.percent_off || 0) > (prev.percent_off || 0)) {
          promoBySlug[sl] = pr;
        }
      }
    }

    for (var i = 0; i < catalog.models.length; i++) {
      var entry = catalog.models[i];
      var m = entry.model || {};
      if (m.status && m.status !== 'active') continue;
      if (Array.isArray(m.output_modalities) && m.output_modalities.indexOf('text') === -1) continue;

      var provs = entry.providers || [];
      var hostProvs = [];
      for (var hp = 0; hp < provs.length; hp++) {
        if (provs[hp].billing_source === 'host_managed' && provs[hp].status !== 'retired') hostProvs.push(provs[hp]);
      }
      if (hostProvs.length === 0) continue;

      var disc = { free: 0, pro: 0, max: 0, ultra: 0 };
      var pricedProvs = [];
      for (var pIdx = 0; pIdx < hostProvs.length; pIdx++) {
        var pv = hostProvs[pIdx];
        if (pv.plan_discounts) {
          var tiers = ['free', 'pro', 'max', 'ultra'];
          for (var ti = 0; ti < tiers.length; ti++) {
            var tn = tiers[ti];
            if ((pv.plan_discounts[tn] || 0) > disc[tn]) disc[tn] = pv.plan_discounts[tn];
          }
        }
        if (pv.input_nano_usd_per_million !== null && pv.input_nano_usd_per_million !== undefined) {
          pricedProvs.push(pv);
        }
      }

      pricedProvs.sort(function (a, b) {
        return ((a.input_nano_usd_per_million || 0) - (b.input_nano_usd_per_million || 0)) ||
          ((a.output_nano_usd_per_million || 0) - (b.output_nano_usd_per_million || 0));
      });
      var bestProv = pricedProvs[0] || null;
      var inUsd = bestProv ? bestProv.input_nano_usd_per_million / 1e9 : null;
      var outUsd = bestProv ? (bestProv.output_nano_usd_per_million || 0) / 1e9 : null;

      var promo = promoBySlug[m.slug] || null;
      var promoPct = promo && promo.percent_off ? promo.percent_off : 0;
      var isAllZero = pricedProvs.length > 0;
      for (var zp = 0; zp < pricedProvs.length; zp++) {
        if (pricedProvs[zp].input_nano_usd_per_million !== 0 || (pricedProvs[zp].output_nano_usd_per_million || 0) !== 0) {
          isAllZero = false;
          break;
        }
      }
      var isFreeCore = disc.pro >= 100 && disc.max >= 100 && disc.ultra >= 100 && disc.free === 0;
      var isPromoFree = Boolean(promo && promo.free);
      var hasPlanDisc = disc.free > 0 || disc.pro > 0 || disc.max > 0 || disc.ultra > 0;

      var discParts = [];
      if (promoPct > 0) discParts.push(promoPct + '% OFF Promo');
      if (disc.free > 0) discParts.push(disc.free + '% Free');
      if (disc.pro > 0) discParts.push(disc.pro + '% Pro');
      if (disc.max > 0) discParts.push(disc.max + '% Max');
      if (disc.ultra > 0) discParts.push(disc.ultra + '% Ultra');

      var item = {
        id: m.slug,
        tools: Boolean(m.supported_params && m.supported_params.tools),
        ctxStr: m.context_window ? Math.round(m.context_window / 1024) + 'K' : 'Auto',
        inUsd: inUsd,
        outUsd: outUsd,
        disc: disc,
        promo: promo,
        promoPct: promoPct,
        discLabel: discParts.join(' | ')
      };

      if (isFreeCore || isPromoFree || isAllZero) freeList.push(item);
      else if (promoPct > 0 || hasPlanDisc) discountList.push(item);
    }

    freeList.sort(function (a, b) {
      return (Number(b.tools) - Number(a.tools)) || a.id.localeCompare(b.id);
    });
    discountList.sort(function (a, b) {
      return (b.promoPct - a.promoPct) ||
        (b.disc.free - a.disc.free) ||
        (b.disc.ultra - a.disc.ultra) ||
        (b.disc.max - a.disc.max) ||
        (b.disc.pro - a.disc.pro) ||
        a.id.localeCompare(b.id);
    });
  }

  var tagMap = {};
  console.log(C.gold + '* ZERO-COST PROMOTIONAL TIER (FREE):' + C.reset);
  for (var f = 0; f < freeList.length; f++) {
    var fm = freeList[f];
    var ftag = 'F' + (f + 1);
    var assignId = (fm.promo && fm.promo.free_only_via_suffix && !/:free$/.test(fm.id)) ? fm.id + ':free' : fm.id;
    tagMap[ftag] = assignId;
    var active = '';
    if ((fm.id === cfg.primary || assignId === cfg.primary) && (fm.id === cfg.fast || assignId === cfg.fast)) {
      active = C.green + ' < ACTIVE PRIMARY + FAST' + C.reset;
    } else if (fm.id === cfg.primary || assignId === cfg.primary) {
      active = C.gold + ' < ACTIVE PRIMARY' + C.reset;
    } else if (fm.id === cfg.fast || assignId === cfg.fast) {
      active = C.cyan + ' < ACTIVE FAST' + C.reset;
    }
    var freeNote = (fm.promo && fm.promo.label) ? fm.promo.label : 'Free Core';
    if (!fm.tools) freeNote += ' [No Tools]';
    console.log('  ' + C.green + padEnd('[' + ftag + ']', 6) + C.reset + C.white + padEnd(fm.id, 30) + C.reset + C.gray + '(' + padEnd(fm.ctxStr, 5) + ') ' + freeNote + C.reset + active);
  }

  console.log('\n' + C.cyan + '% DISCOUNTED MODELS (' + discountList.length + ' Active Promos & Plan Discounts):' + C.reset);
  for (var k = 0; k < discountList.length; k++) {
    var dm = discountList[k];
    var dtag = 'D' + (k + 1);
    tagMap[dtag] = dm.id;
    var priceStr = (dm.inUsd !== null && dm.outUsd !== null) ? '$' + fmtPrice(dm.inUsd) + '/$' + fmtPrice(dm.outUsd) : '';
    var dActive = dm.id === cfg.primary ? C.gold + ' < ACTIVE PRIMARY' + C.reset : '';
    console.log('  ' + C.magenta + padEnd('[' + dtag + ']', 6) + C.reset + C.white + padEnd(dm.id, 30) + C.reset + C.gray + '(' + padEnd(dm.ctxStr, 5) + ') ' + padEnd(priceStr, 14) + C.cyan + dm.discLabel + C.reset + dActive);
  }

  console.log('\nOptions:');
  console.log('  1. Set GPT-6 Luna (Primary) + DeepSeek Flash 1017 (Fast) [Zero Cost]');
  console.log('  2. Set DeepSeek Flash 1017 (All-round speed) [Zero Cost]');
  console.log('  3. Manually enter Primary & Fast model names');
  console.log('  Tip: Type any tag above (e.g. F1 or D1) directly to switch Primary model.');
  console.log('  0. Cancel\n');

  var sel = (await ask('Select [1-3, F#, D#, 0]: ')).trim();
  if (!sel || sel === '0' || sel.toLowerCase() === 'q') return;

  var upper = sel.toUpperCase();
  if (tagMap[upper]) {
    var chosen = tagMap[upper];
    applyModelPair(chosen, cfg.fast);
    console.log(C.green + '[+] Primary model switched to ' + chosen + ' (Fast: ' + cfg.fast + ')' + C.reset);
    return;
  }
  if (sel === '1') {
    applyModelPair('gpt-6-luna', 'deepseek-v4.1-flash-1017');
    console.log(C.green + '[+] Switched to gpt-6-luna + deepseek-v4.1-flash-1017!' + C.reset);
  } else if (sel === '2') {
    applyModelPair('deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017');
    console.log(C.green + '[+] Switched to deepseek-v4.1-flash-1017!' + C.reset);
  } else if (sel === '3') {
    var pName = await ask('Primary model name [' + cfg.primary + ']: ');
    var fName = await ask('Fast model name [' + cfg.fast + ']: ');
    applyModelPair(pName || cfg.primary, fName || cfg.fast);
    console.log(C.green + '[+] Model pair updated!' + C.reset);
  }
}

// ============================================================================
// 3. JEV SYSTEM-1 INTERVENTION CONSOLE ([J])
// ============================================================================
async function manageJev() {
  while (true) {
    clearScreen();
    var cfg = getConfigSummary();
    console.log(C.cyan + '============================================================================' + C.reset);
    console.log(C.gold + '  007 Q-BRANCH : JEV & CLEF SYSTEM-1 INTERVENTION (LEGACY MAC EDITION)' + C.reset);
    console.log(C.cyan + '============================================================================' + C.reset);
    console.log('  Endpoint Origin  : ' + C.cyan + cfg.baseOrigin + C.reset);
    console.log('  API Key          : ' + (cfg.apiKey ? C.green + maskKey(cfg.apiKey) : C.red + 'MISSING') + C.reset);
    console.log('  Direct Agent Tool: ' + C.green + 'jev_judge built-in (zero-token /v1/systemone)' + C.reset);
    console.log(C.cyan + '----------------------------------------------------------------------------' + C.reset);
    console.log('  ' + C.green + '[1]' + C.reset + ' Live Latency Test  - Probe jev-latest & clef on /v1/systemone');
    console.log('  ' + C.red + '[0]' + C.reset + ' Return to Main Menu\n');

    var c = (await ask('Select action [1, 0]: ')).toLowerCase();
    if (!c || c === '0' || c === 'q') break;
    if (c === '1') {
      if (!cfg.apiKey) {
        console.log(C.red + 'X Missing API key. Set it in [S] Gateway Settings.' + C.reset);
      } else {
        console.log('\n' + C.gold + '[*] Testing live /v1/systemone round-trips over TLS 1.3...' + C.reset);
        var models = ['jev-latest', 'clef'];
        for (var i = 0; i < models.length; i++) {
          var mod = models[i];
          try {
            var res = await httpRequest(cfg.baseOrigin + '/v1/systemone', {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + cfg.apiKey,
                'Content-Type': 'application/json'
              },
              body: {
                model: mod,
                state: 'Q-Branch diagnostic probe: system ready OK.',
                questions: {
                  ready: { type: 'noul', instructions: 'Does this state indicate the system is ready OK?' }
                }
              },
              timeoutMs: 12000
            });
            if (res.status === 200) {
              var parsed = {};
              try { parsed = JSON.parse(res.text); } catch (e) {}
              var ans = parsed && parsed.answers && parsed.answers.ready ? parsed.answers.ready.noul : null;
              var score = typeof ans === 'number' ? ans.toFixed(3) : 'ok';
              console.log('  ' + C.green + '[OK]' + C.reset + ' ' + padEnd(mod, 12) + res.elapsedMs + 'ms (noul score: ' + score + ')');
            } else {
              console.log('  ' + C.red + '[ERR]' + C.reset + ' ' + padEnd(mod, 12) + 'HTTP ' + res.status + ' ' + res.text.slice(0, 120));
            }
          } catch (e) {
            console.log('  ' + C.red + '[ERR]' + C.reset + ' ' + padEnd(mod, 12) + e.message);
          }
        }
      }
      console.log('');
      await ask('Press Enter to continue... ');
    }
  }
}

// ============================================================================
// 4. SKILLS ARSENAL ([K])
// ============================================================================
async function manageSkills(workDir) {
  while (true) {
    clearScreen();
    var skills = listAvailableSkills();
    var names = Object.keys(skills).sort();
    console.log(C.cyan + '============================================================================' + C.reset);
    console.log(C.gold + '  007 Q-BRANCH : SKILLS ARSENAL (' + names.length + ' SKILLS READY)' + C.reset);
    console.log(C.cyan + '============================================================================' + C.reset);
    for (var i = 0; i < names.length; i += 3) {
      var col1 = names[i] ? padEnd('[' + (i + 1) + '] ' + names[i], 25) : '';
      var col2 = names[i + 1] ? padEnd('[' + (i + 2) + '] ' + names[i + 1], 25) : '';
      var col3 = names[i + 2] ? ('[' + (i + 3) + '] ' + names[i + 2]) : '';
      console.log('  ' + C.white + col1 + col2 + col3 + C.reset);
    }
    console.log(C.cyan + '----------------------------------------------------------------------------' + C.reset);
    console.log('  Enter skill number to view/deploy into current folder (' + workDir + '), or 0 to return.\n');
    var c = (await ask('Select skill [1-' + names.length + ', 0]: ')).trim();
    if (!c || c === '0' || c.toLowerCase() === 'q') break;
    var num = parseInt(c, 10);
    if (num >= 1 && num <= names.length) {
      var skName = names[num - 1];
      var sk = skills[skName];
      var content = fs.readFileSync(sk.md, 'utf8');
      console.log('\n' + C.gold + '--- ' + skName + ' ---' + C.reset);
      console.log(content.slice(0, 1200) + (content.length > 1200 ? '\n...(truncated)...' : ''));
      var dep = (await ask('\nDeploy "' + skName + '" into ' + path.join(workDir, '.claude', 'skills', skName) + '? [y/N]: ')).toLowerCase();
      if (dep === 'y' || dep === 'yes') {
        copyDirSync(sk.dir, path.join(workDir, '.claude', 'skills', skName));
        console.log(C.green + '[+] Deployed ' + skName + '!' + C.reset);
        await ask('Press Enter to continue... ');
      }
    }
  }
}

// ============================================================================
// 5. GATEWAY SETTINGS ([S])
// ============================================================================
async function configureApi() {
  var cfg = getConfigSummary();
  console.log('\n' + C.gold + '=== 007 Q-BRANCH : GATEWAY SETTINGS ===' + C.reset);
  console.log('  Current Gateway URL : ' + C.cyan + cfg.baseOrigin + C.reset);
  console.log('  Current API Key     : ' + C.green + maskKey(cfg.apiKey) + C.reset);
  console.log('  Primary / Fast      : ' + C.gold + cfg.primary + C.reset + ' / ' + C.cyan + cfg.fast + C.reset + '\n');

  var newUrl = await ask('New Gateway URL (Enter to keep current): ');
  var newKey = await ask('New API Key (Enter to keep current): ');

  var s = cfg.settings;
  s.env = s.env || {};
  if (newUrl) {
    var clean = newUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    s.env.ANTHROPIC_BASE_URL = clean;
    s.env.TYPESAFE_BASE_URL = clean;
  }
  if (newKey) {
    s.env.ANTHROPIC_AUTH_TOKEN = newKey;
    s.env.TYPESAFE_API_KEY = newKey;
  }
  saveSettings(s);
  console.log(C.green + '[+] Settings saved to ' + getSettingsPath() + C.reset);
}

// ============================================================================
// 6. LOCAL SERVER SECURITY AUDIT ([L] - Strictly Local-Only)
// ============================================================================
var SYSTEM_PROCS = {
  system: 1, idle: 1, 'svchost.exe': 1, 'lsass.exe': 1, 'wininit.exe': 1,
  'services.exe': 1, 'spoolsv.exe': 1, rapportd: 1, controlcenter: 1,
  airplayxpchelper: 1, mdnsresponder: 1, launchd: 1, sharingd: 1,
  identityservicesd: 1, blued: 1, cupsd: 1
};

function normHost(h) {
  return String(h || '').trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
}

function getLocalIps() {
  var set = { '127.0.0.1': 1, '::1': 1, localhost: 1, '0.0.0.0': 1, '::': 1 };
  try {
    var ifaces = os.networkInterfaces();
    var keys = Object.keys(ifaces);
    for (var i = 0; i < keys.length; i++) {
      var list = ifaces[keys[i]] || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].address) set[normHost(list[j].address)] = 1;
      }
    }
  } catch (e) {}
  return set;
}

function discoverListeningPorts(includeSystem) {
  var byPort = {};
  function add(port, pid, proc, bindRaw) {
    if (!port || port <= 0) return;
    if (!byPort[port]) {
      byPort[port] = { port: port, pids: {}, procs: {}, bindings: {}, hasUser: false };
    }
    var e = byPort[port];
    e.pids[String(pid)] = 1;
    e.procs[proc] = 1;
    e.bindings[bindRaw] = 1;
    if (!SYSTEM_PROCS[proc.toLowerCase()] && port !== 135 && port !== 445 && port !== 5040) {
      e.hasUser = true;
    }
  }

  if (IS_WIN) {
    var ns = childProcess.execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    var tl = childProcess.execSync('tasklist /FO CSV /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    var pidMap = {};
    var tlLines = tl.split(/\r?\n/);
    for (var t = 0; t < tlLines.length; t++) {
      var tm = tlLines[t].match(/^"([^"]+)","(\d+)"/);
      if (tm) pidMap[tm[2]] = tm[1];
    }
    var nsLines = ns.split(/\r?\n/);
    for (var n = 0; n < nsLines.length; n++) {
      var nm = nsLines[n].match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (!nm) continue;
      var lc = nm[1].lastIndexOf(':');
      if (lc <= 0) continue;
      add(Number(nm[1].slice(lc + 1)), nm[2], pidMap[nm[2]] || ('pid:' + nm[2]), nm[1].slice(0, lc));
    }
  } else {
    var lsof = childProcess.execSync('lsof -nP -iTCP -sTCP:LISTEN', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    var lines = lsof.split(/\r?\n/).slice(1);
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].trim().split(/\s+/);
      if (parts.length < 9) continue;
      var proc = parts[0].replace(/\\x20/g, ' ');
      var pid = parts[1];
      var tok = null;
      for (var p = 0; p < parts.length; p++) {
        if (/:\d+$/.test(parts[p])) { tok = parts[p]; break; }
      }
      if (!tok) continue;
      var cIdx = tok.lastIndexOf(':');
      var bRaw = tok.slice(0, cIdx);
      if (bRaw === '*') bRaw = '0.0.0.0';
      add(Number(tok.slice(cIdx + 1)), pid, proc, bRaw);
    }
  }

  var out = [];
  var portKeys = Object.keys(byPort);
  for (var k = 0; k < portKeys.length; k++) {
    var item = byPort[portKeys[k]];
    if (!includeSystem && !item.hasUser) continue;
    var bList = Object.keys(item.bindings);
    var lan = false;
    for (var b = 0; b < bList.length; b++) {
      var nb = normHost(bList[b]);
      if (nb !== '127.0.0.1' && nb !== '::1') lan = true;
    }
    out.push({
      port: item.port,
      pids: Object.keys(item.pids),
      processes: Object.keys(item.procs),
      bindings: bList,
      exposure: lan ? 'LAN-EXPOSED' : 'LOOPBACK-ONLY'
    });
  }
  out.sort(function (a, b) { return a.port - b.port; });
  return out;
}

async function inspectLocalEndpoint(rawInput, list) {
  var trimmed = String(rawInput || '').trim();
  if (!trimmed) return;
  var target = /^\d+$/.test(trimmed)
    ? 'http://127.0.0.1:' + trimmed + '/'
    : (/^https?:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed);
  var parsed = urlMod.parse(target);
  if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    console.log(C.red + 'X Invalid local URL: ' + trimmed + C.reset);
    return;
  }
  var ips = getLocalIps();
  if (!ips[normHost(parsed.hostname)]) {
    console.log('\n' + C.red + 'X SAFETY REFUSAL: "' + parsed.hostname + '" is not a local address on this machine.' + C.reset);
    return;
  }

  var port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  var sock = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].port === port) { sock = list[i]; break; }
  }
  var reqHost = (normHost(parsed.hostname) === '0.0.0.0' || normHost(parsed.hostname) === '::') ? '127.0.0.1' : parsed.hostname;
  var reqUrl = parsed.protocol + '//' + reqHost + ':' + port + (parsed.path || '/');

  var getRes = null;
  var getErr = '';
  try {
    getRes = await httpRequest(reqUrl, {
      method: 'GET',
      headers: { Origin: 'https://external-observer.example', 'User-Agent': 'QBranch-Local-Audit/1.0' },
      timeoutMs: 2500,
      maxBytes: 8192
    });
  } catch (e) {
    getErr = e.message;
  }

  console.log('\n' + C.cyan + '============================================================================' + C.reset);
  console.log(C.gold + '  LOCAL ENDPOINT AUDIT : ' + target + C.reset);
  console.log(C.cyan + '============================================================================' + C.reset);
  console.log('\n  [1] SOCKET & NETWORK BINDING');
  if (sock) {
    console.log('    Process / PID    : ' + sock.processes.join(', ') + ' (PID ' + sock.pids.join(', ') + ')');
    console.log('    Bound Interfaces : ' + sock.bindings.join(', '));
    console.log('    Exposure Scope   : ' + (sock.exposure === 'LAN-EXPOSED' ? C.gold : C.green) + sock.exposure + C.reset);
  } else {
    console.log('    Socket Status    : Port ' + port + ' not currently listed in TCP LISTEN sockets');
  }
  console.log('\n  [2] OBSERVER FINGERPRINT');
  if (!getRes) {
    console.log('    HTTP Probe       : ' + C.red + 'No HTTP response (' + getErr + ')' + C.reset);
    return;
  }
  var h = getRes.headers;
  console.log('    HTTP Status      : ' + C.green + getRes.status + ' ' + getRes.statusText + C.reset + ' (' + getRes.elapsedMs + 'ms)');
  console.log('    Server Banner    : ' + (h.server || '(not disclosed)'));
  if (h['x-powered-by']) console.log('    X-Powered-By     : ' + C.gold + h['x-powered-by'] + C.reset);
  console.log('    Content-Type     : ' + (h['content-type'] || '(none)'));

  console.log('\n  [3] SECURITY POSTURE');
  var acao = h['access-control-allow-origin'] || '';
  if (acao === '*' || acao === 'https://external-observer.example') {
    console.log('    ' + C.gold + 'MEDIUM' + C.reset + '  Open CORS (' + acao + '): external browser tabs can read this local port.');
  } else {
    console.log('    ' + C.green + 'PASS' + C.reset + '    CORS blocked untrusted Origin.');
  }
  var checks = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'cross-origin-resource-policy', 'referrer-policy'];
  for (var c = 0; c < checks.length; c++) {
    var k = checks[c];
    console.log('    ' + (h[k] ? C.green + '[OK] ' : C.gray + '[-]  ') + padEnd(k, 28) + ': ' + (h[k] || 'missing') + C.reset);
  }
  console.log('\n  [4] REMEDIATIONS');
  console.log('    - Bind dev servers to 127.0.0.1 unless LAN access is required.');
  console.log('    - Restrict CORS Access-Control-Allow-Origin to explicit trusted origins.');
  console.log('    - Add X-Content-Type-Options: nosniff and Cross-Origin-Resource-Policy: same-origin.');
}

async function manageLocalAudit() {
  var includeSystem = false;
  while (true) {
    clearScreen();
    console.log(C.cyan + '============================================================================' + C.reset);
    console.log(C.gold + '  007 Q-BRANCH : LOCAL SERVER SECURITY AUDITOR (STRICTLY LOCAL-ONLY)' + C.reset);
    console.log(C.cyan + '============================================================================' + C.reset);
    var ports = [];
    try {
      ports = discoverListeningPorts(includeSystem);
    } catch (e) {
      console.log(C.red + '  X Socket scan failed: ' + e.message + C.reset);
    }
    if (ports.length === 0) {
      console.log('  No active local application servers detected. Use [U] to test a local port or [A] for system ports.');
    } else {
      for (var i = 0; i < ports.length; i++) {
        var s = ports[i];
        var scope = s.exposure === 'LAN-EXPOSED' ? C.gold + 'LAN-EXPOSED  ' + C.reset : C.green + 'LOOPBACK-ONLY' + C.reset;
        console.log('  ' + C.green + padEnd('[' + (i + 1) + ']', 5) + C.reset + C.white + padEnd(':' + s.port, 7) + C.reset + padEnd(s.processes.join(',').slice(0, 18), 19) + scope);
      }
    }
    console.log(C.cyan + '----------------------------------------------------------------------------' + C.reset);
    console.log('  [1..N] Deep-inspect  [U] Custom local URL/port  [A] Toggle system ports  [R] Rescan  [0] Back\n');
    var ch = (await ask('Select option: ')).toLowerCase();
    if (!ch || ch === '0' || ch === 'q') break;
    if (ch === 'a') includeSystem = !includeSystem;
    else if (ch === 'r') continue;
    else if (ch === 'u') {
      var u = await ask('Enter local URL or port (e.g. 3000, localhost:8080): ');
      if (u) {
        await inspectLocalEndpoint(u, ports);
        await ask('\nPress Enter to continue... ');
      }
    } else {
      var n = parseInt(ch, 10);
      if (n >= 1 && n <= ports.length) {
        await inspectLocalEndpoint('http://127.0.0.1:' + ports[n - 1].port + '/', ports);
        await ask('\nPress Enter to continue... ');
      }
    }
  }
}

// ============================================================================
// 7. DIRECT AUTONOMOUS CODING AGENT (Mountain Lion / Node 10 Native!)
// ============================================================================
function walkTree(dir, depth, maxDepth, out) {
  if (depth > maxDepth || out.length >= 220) return out;
  var skip = { '.git': 1, node_modules: 1, __pycache__: 1, '.venv': 1, dist: 1, build: 1, '.DS_Store': 1 };
  var names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (skip[name]) continue;
    var full = path.join(dir, name);
    var rel = path.relative(process.cwd(), full) || name;
    var isDir = false;
    try { isDir = fs.statSync(full).isDirectory(); } catch (e) { continue; }
    out.push(isDir ? rel + '/' : rel);
    if (out.length >= 220) break;
    if (isDir && depth < maxDepth) walkTree(full, depth + 1, maxDepth, out);
  }
  return out;
}

function searchFilesText(pattern, startDir) {
  var matches = [];
  var root = path.resolve(process.cwd(), startDir || '.');
  var regex;
  try { regex = new RegExp(pattern, 'i'); }
  catch (e) { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  var items = walkTree(root, 0, 5, []);
  for (var i = 0; i < items.length; i++) {
    if (matches.length >= 80) break;
    if (items[i].slice(-1) === '/') continue;
    var full = path.resolve(process.cwd(), items[i]);
    try {
      if (fs.statSync(full).size > 512 * 1024) continue;
      var lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      for (var l = 0; l < lines.length; l++) {
        if (regex.test(lines[l])) {
          matches.push(items[i] + ':' + (l + 1) + ': ' + lines[l].slice(0, 180));
          if (matches.length >= 80) break;
        }
      }
    } catch (e) {}
  }
  return matches.length ? matches.join('\n') : 'No matches found.';
}

var TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command in the current working directory and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          start_line: { type: 'integer' },
          end_line: { type: 'integer' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with full content.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['file_path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact substring inside an existing file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string' }
        },
        required: ['file_path', 'old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and subdirectories in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string' },
          max_depth: { type: 'integer' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Search text or regex pattern across files in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          dir_path: { type: 'string' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load a Q-Branch SKILL.md playbook by name, or pass "list" to see all available skills.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jev_judge',
      description: 'Run a fast zero-output-token System-1 binary check via Jev (/v1/systemone).',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question']
      }
    }
  }
];

async function runAgent(extraArgs) {
  var yolo = false;
  var modelOverride = '';
  var oneShot = '';
  for (var i = 0; i < extraArgs.length; i++) {
    var a = extraArgs[i];
    if (a === '--yolo' || a === '-y') yolo = true;
    else if ((a === '-m' || a === '--model') && extraArgs[i + 1]) modelOverride = extraArgs[++i];
    else if ((a === '-p' || a === '--prompt') && extraArgs[i + 1]) oneShot = extraArgs[++i];
  }

  var cfg = getConfigSummary();
  var activeModel = modelOverride || cfg.primary;
  var skills = listAvailableSkills();
  var skillNames = Object.keys(skills).sort();

  if (!cfg.apiKey) {
    console.log(C.red + 'X No API key found. Set your key in [S] Gateway Settings first.' + C.reset);
    return;
  }

  async function confirmAction(desc) {
    if (yolo) return true;
    if (oneShot) return false;
    var ans = (await ask(C.gold + 'Approve action? ' + C.white + desc + C.gold + ' [y/N/a(ll)]: ' + C.reset)).toLowerCase();
    if (ans === 'a' || ans === 'all') {
      yolo = true;
      console.log(C.gold + '[*] YOLO auto-approve enabled for this session.' + C.reset);
      return true;
    }
    return ans === 'y' || ans === 'yes';
  }

  async function execTool(name, rawArgs) {
    var args = {};
    try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {}); }
    catch (e) { return 'Error parsing arguments: ' + e.message; }

    if (name === 'list_dir') {
      var d = path.resolve(process.cwd(), args.dir_path || '.');
      var res = walkTree(d, 0, Math.min(Number(args.max_depth) || 3, 5), []);
      return res.length ? res.join('\n') : '(empty directory)';
    }
    if (name === 'search_text') {
      return searchFilesText(args.pattern || '', args.dir_path || '.');
    }
    if (name === 'read_file') {
      var rp = path.resolve(process.cwd(), args.file_path || '');
      if (!fs.existsSync(rp)) return 'File not found: ' + rp;
      var lines = fs.readFileSync(rp, 'utf8').split(/\r?\n/);
      var sLine = Math.max(1, Number(args.start_line) || 1);
      var eLine = Math.min(lines.length, Number(args.end_line) || (sLine + 249));
      var numbered = [];
      for (var ln = sLine; ln <= eLine; ln++) numbered.push(ln + ': ' + lines[ln - 1]);
      return numbered.join('\n').slice(0, 24000);
    }
    if (name === 'write_file') {
      var wp = path.resolve(process.cwd(), args.file_path || '');
      var wOk = await confirmAction('write_file -> ' + wp);
      if (!wOk) return 'Declined by user.';
      mkdirp(path.dirname(wp));
      fs.writeFileSync(wp, String(args.content !== undefined ? args.content : ''), 'utf8');
      return 'Wrote ' + wp + ' successfully.';
    }
    if (name === 'edit_file') {
      var ep = path.resolve(process.cwd(), args.file_path || '');
      if (!fs.existsSync(ep)) return 'File not found: ' + ep;
      var cur = fs.readFileSync(ep, 'utf8');
      if (cur.indexOf(args.old_text) === -1) return 'Target text not found in ' + ep;
      var eOk = await confirmAction('edit_file -> ' + ep);
      if (!eOk) return 'Declined by user.';
      fs.writeFileSync(ep, cur.replace(args.old_text, args.new_text || ''), 'utf8');
      return 'Updated ' + ep + ' successfully.';
    }
    if (name === 'run_shell') {
      var cmdStr = String(args.command || '').trim();
      var cwd = path.resolve(process.cwd(), args.cwd || '.');
      var cOk = await confirmAction('run_shell: ' + cmdStr);
      if (!cOk) return 'Declined by user.';
      try {
        var out = childProcess.execSync(cmdStr, {
          cwd: cwd,
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        return (out || '(exit 0, no output)').slice(0, 12000);
      } catch (e) {
        return ((e.stdout || '') + '\n' + (e.stderr || '') + '\nExit: ' + (e.status || 1)).trim().slice(0, 12000);
      }
    }
    if (name === 'load_skill') {
      if (!args.name || args.name === 'list') {
        return 'Available skills (' + skillNames.length + '): ' + skillNames.join(', ');
      }
      if (!skills[args.name]) {
        return 'Skill "' + args.name + '" not found. Available: ' + skillNames.join(', ');
      }
      return fs.readFileSync(skills[args.name].md, 'utf8').slice(0, 16000);
    }
    if (name === 'jev_judge') {
      try {
        var jRes = await httpRequest(cfg.baseOrigin + '/v1/systemone', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
          body: {
            model: 'jev-latest',
            state: String(args.state || args.question || ''),
            questions: {
              judgment: { type: 'noul', instructions: String(args.question || 'Evaluate this statement.') }
            }
          },
          timeoutMs: 10000
        });
        return 'Jev (HTTP ' + jRes.status + '): ' + jRes.text.slice(0, 800);
      } catch (e) {
        return 'Jev error: ' + e.message;
      }
    }
    return 'Unknown tool: ' + name;
  }

  var messages = [{
    role: 'system',
    content: [
      'You are the 007 Q-Branch Direct Autonomous Coding Agent running natively on ' + process.platform + ' (' + os.arch() + ', Node ' + process.version + ').',
      'Current working folder: ' + process.cwd(),
      'Tools available: run_shell, read_file, write_file, edit_file, list_dir, search_text, load_skill, jev_judge.',
      'Available Q-Branch skills (' + skillNames.length + '): ' + skillNames.slice(0, 30).join(', ') + '.',
      'Keep responses concise, practical, and verify changes.'
    ].join('\n')
  }];

  async function runTurn(userText) {
    messages.push({ role: 'user', content: userText });
    for (var step = 0; step < 20; step++) {
      process.stdout.write(C.gray + '[*] Thinking (' + activeModel + ')...' + C.reset + '\r');
      var res;
      try {
        res = await httpRequest(cfg.baseOrigin + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + cfg.apiKey,
            'Content-Type': 'application/json'
          },
          body: {
            model: activeModel,
            messages: messages,
            tools: TOOL_DEFS,
            tool_choice: 'auto'
          },
          timeoutMs: 120000
        });
      } catch (e) {
        process.stdout.write('                                                            \r');
        console.log(C.red + 'X Network error: ' + e.message + C.reset);
        return;
      }
      process.stdout.write('                                                            \r');
      if (res.status < 200 || res.status >= 300) {
        console.log(C.red + 'X Gateway HTTP ' + res.status + ': ' + res.text.slice(0, 400) + C.reset);
        return;
      }
      var data;
      try { data = JSON.parse(res.text); } catch (e) {
        console.log(C.red + 'X Invalid JSON from gateway.' + C.reset);
        return;
      }
      var msg = data && data.choices && data.choices[0] ? data.choices[0].message : null;
      if (!msg) {
        console.log(C.red + 'X Empty model response.' + C.reset);
        return;
      }
      messages.push(msg);
      if (msg.content && String(msg.content).trim()) {
        console.log('\n' + C.cyan + 'Q-Branch >' + C.reset + '\n' + String(msg.content).trim() + '\n');
      }
      var calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (calls.length === 0) break;
      for (var t = 0; t < calls.length; t++) {
        var tc = calls[t];
        var fn = tc && tc.function ? tc.function.name : 'unknown';
        var argStr = tc && tc.function ? String(tc.function.arguments || '') : '{}';
        console.log('  ' + C.magenta + '[tool]' + C.reset + ' ' + C.white + fn + C.reset + ' ' + C.gray + argStr.slice(0, 90) + C.reset);
        var toolOut = await execTool(fn, argStr);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(toolOut) });
      }
    }
  }

  if (oneShot) {
    await runTurn(oneShot);
    return;
  }

  clearScreen();
  console.log(C.cyan + '============================================================================' + C.reset);
  console.log(C.gold + '  007 Q-BRANCH : DIRECT AGENT (MOUNTAIN LION / LEGACY MAC NATIVE EDITION)' + C.reset);
  console.log(C.cyan + '============================================================================' + C.reset);
  console.log('  Platform / Node  : ' + C.white + process.platform + ' (' + os.arch() + ') | Node ' + process.version + ' (OpenSSL TLS 1.3)' + C.reset);
  console.log('  Working Folder   : ' + C.cyan + process.cwd() + C.reset);
  console.log('  Active Model     : ' + C.gold + activeModel + C.reset + C.gray + ' (Fast: ' + cfg.fast + ')' + C.reset);
  console.log('  Skills Loaded    : ' + C.green + skillNames.length + ' Q-Branch skills' + C.reset + C.gray + ' | Mode: ' + (yolo ? 'YOLO (Auto)' : 'Interactive') + C.reset);
  console.log('  Commands         : ' + C.white + '/help  /model  /fast  /skills  /skill <name>  /yolo  /cd  /save  /exit' + C.reset);
  console.log(C.cyan + '----------------------------------------------------------------------------' + C.reset + '\n');

  while (true) {
    var input = await ask(C.green + '007 > ' + C.reset);
    if (!input) {
      if (process.stdin.readableEnded) break;
      continue;
    }
    if (input === '/exit' || input === '/quit' || input === 'exit' || input === 'quit') break;
    if (input === '/help') {
      console.log('  /model <id>    Switch active model (current: ' + activeModel + ')');
      console.log('  /fast          Toggle between Primary (' + cfg.primary + ') and Fast (' + cfg.fast + ')');
      console.log('  /skills        List all ' + skillNames.length + ' available Q-Branch skills');
      console.log('  /skill <name>  Load a skill playbook into context');
      console.log('  /yolo          Toggle auto-approve for shell & file edits (' + (yolo ? 'ON' : 'OFF') + ')');
      console.log('  /cd <dir>      Change working folder');
      console.log('  /clear         Clear conversation history');
      console.log('  /save          Save transcript to Markdown');
      console.log('  /exit          Return to Q-Branch Menu\n');
      continue;
    }
    if (input.indexOf('/model') === 0) {
      var m = input.slice(6).trim();
      if (m) {
        activeModel = m;
        console.log(C.green + '[+] Switched model to ' + activeModel + C.reset + '\n');
      } else {
        console.log(C.gold + 'Active model:' + C.reset + ' ' + activeModel + '\n');
      }
      continue;
    }
    if (input === '/fast') {
      activeModel = activeModel === cfg.fast ? cfg.primary : cfg.fast;
      console.log(C.green + '[+] Active model now: ' + activeModel + C.reset + '\n');
      continue;
    }
    if (input === '/yolo') {
      yolo = !yolo;
      console.log(C.gold + '[+] YOLO auto-approve: ' + (yolo ? 'ON' : 'OFF') + C.reset + '\n');
      continue;
    }
    if (input === '/skills') {
      console.log(C.cyan + 'Skills (' + skillNames.length + '): ' + C.reset + skillNames.join(', ') + '\n');
      continue;
    }
    if (input.indexOf('/skill ') === 0) {
      var skN = input.slice(7).trim();
      if (!skills[skN]) {
        console.log(C.red + 'X Skill not found: ' + skN + C.reset + '\n');
      } else {
        messages.push({ role: 'system', content: 'Active Skill (' + skN + '):\n' + fs.readFileSync(skills[skN].md, 'utf8').slice(0, 16000) });
        console.log(C.green + '[+] Loaded skill "' + skN + '" into context.' + C.reset + '\n');
      }
      continue;
    }
    if (input.indexOf('/cd ') === 0) {
      var dir = path.resolve(process.cwd(), input.slice(4).trim());
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        process.chdir(dir);
        console.log(C.green + '[+] Working folder: ' + process.cwd() + C.reset + '\n');
      } else {
        console.log(C.red + 'X Folder not found: ' + dir + C.reset + '\n');
      }
      continue;
    }
    if (input === '/clear') {
      messages.splice(1);
      console.log(C.green + '[+] Conversation cleared.' + C.reset + '\n');
      continue;
    }
    if (input === '/save') {
      var sDir = process.env.QBRANCH_MAC_HOME ? path.join(process.env.QBRANCH_MAC_HOME, 'sessions') : path.join(os.tmpdir(), 'qbranch-sessions');
      mkdirp(sDir);
      var outF = path.join(sDir, 'session-' + Date.now() + '.md');
      var linesOut = [];
      for (var mi = 1; mi < messages.length; mi++) {
        if (messages[mi].role === 'user' || messages[mi].role === 'assistant') {
          linesOut.push('## ' + messages[mi].role.toUpperCase() + '\n\n' + (messages[mi].content || '(tool calls)'));
        }
      }
      fs.writeFileSync(outF, linesOut.join('\n\n---\n\n'), 'utf8');
      console.log(C.green + '[+] Saved transcript to ' + outF + C.reset + '\n');
      continue;
    }
    await runTurn(input);
  }
}

// ============================================================================
// MAIN CLI ROUTER
// ============================================================================
async function main() {
  var args = process.argv.slice(2);
  var cmd = (args[0] || 'status').toLowerCase();
  var rest = args.slice(1);
  if (cmd === 'env-summary') printEnvSummary();
  else if (cmd === 'status') showStatus();
  else if (cmd === 'models') await browseModels();
  else if (cmd === 'jev') await manageJev();
  else if (cmd === 'skills') await manageSkills(process.cwd());
  else if (cmd === 'local-audit' || cmd === 'scan' || cmd === 'audit') await manageLocalAudit();
  else if (cmd === 'config') await configureApi();
  else if (cmd === 'agent') await runAgent(rest);
  else showStatus();
}

main().then(function () {
  closeRl();
}).catch(function (err) {
  console.error(C.red + 'X Error: ' + (err && err.message ? err.message : err) + C.reset);
  closeRl();
  process.exit(1);
});
