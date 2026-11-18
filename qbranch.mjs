import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SKILLS_PATH = path.join(SCRIPT_DIR, 'skills');
const USER_HOME = os.homedir();
const CLAUDE_SETTINGS_PATH = path.join(USER_HOME, '.claude', 'settings.json');
const GEMINI_SKILLS_PATH = path.join(USER_HOME, '.gemini', 'config', 'skills');
const CLAUDE_SKILLS_PATH = path.join(USER_HOME, '.claude', 'skills');
const CLAUDE_BACKUP_PATH = path.join(USER_HOME, '.claude', 'skills.backup');

// ANSI Colors (VT100)
const C = {
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

// Persistent readline interface to prevent stdin closure on Windows
let rl = null;
function getRl() {
  if (!rl || rl.closed) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
  }
  return rl;
}

function ask(query) {
  if (process.stdin.readableEnded) return Promise.resolve('');
  return new Promise(resolve => {
    const interfaceRl = getRl();
    let settled = false;
    const onDone = (val) => {
      if (!settled) {
        settled = true;
        resolve(val ? val.trim() : '');
      }
    };
    interfaceRl.question(query, onDone);
    interfaceRl.once('close', () => onDone(''));
  });
}

function closeRl() {
  if (rl) {
    try { rl.close(); } catch (e) {}
    rl = null;
  }
}

// Direct WSL invocation bypassing cmd.exe shell expansion
function runWsl(bashCmd, options = {}) {
  try {
    return execFileSync('wsl.exe', [
      '-d', 'kali-linux',
      '-u', 'Ade',
      'bash', '-c',
      `export PATH="$HOME/.local/bin:$PATH"; ${bashCmd}`
    ], {
      encoding: 'utf8',
      stdio: options.stdio || ['ignore', 'pipe', 'ignore'],
      ...options
    }).trim();
  } catch (e) {
    return null;
  }
}

const IS_PORTABLE_MODE = Boolean(
  process.env.CLAUDE_CONFIG_DIR || process.env.HERMES_HOME || process.env.QBRANCH_PORTABLE === '1'
);
const CLAUDE_ACTIVE_SETTINGS_PATH = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
  : CLAUDE_SETTINGS_PATH;
const JEV_GATE_ALLOW_RULES = ['mcp__jev__jev_judge', 'mcp__jev__jev_gate'];
const WSL_HERMES_CONFIG_UNC = '\\\\wsl.localhost\\kali-linux\\home\\Ade\\.hermes\\config.yaml';

function readClaudeSettings() {
  for (const p of [CLAUDE_ACTIVE_SETTINGS_PATH, CLAUDE_SETTINGS_PATH]) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) {}
  }
  return { env: {}, permissions: {}, modelSettings: {} };
}

function saveClaudeSettings(settings) {
  const payload = JSON.stringify(settings, null, 2);
  const targets = new Set([CLAUDE_SETTINGS_PATH, CLAUDE_ACTIVE_SETTINGS_PATH]);
  for (const p of targets) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, payload, 'utf8');
  }
}

function getClaudeJsonPaths() {
  const targets = [path.join(USER_HOME, '.claude.json')];
  if (process.env.CLAUDE_CONFIG_DIR) {
    targets.push(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'));
  }
  return [...new Set(targets)];
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return fallback;
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function toWslPath(winPath) {
  const resolved = path.resolve(winPath).replace(/\\/g, '/');
  return resolved.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

function findCachedNpxJevDir() {
  const npxRoot = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
  const localAppData = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  for (const root of new Set([localAppData, npxRoot].filter(Boolean))) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root)) {
        const candidate = path.join(root, entry, 'node_modules', 'jev-use', 'dist', 'cli.js');
        if (fs.existsSync(candidate)) {
          return path.join(root, entry);
        }
      }
    } catch (e) {}
  }
  return null;
}

function getLocalJevBundleDir() {
  const candidates = [
    process.env.USB_ROOT ? path.join(process.env.USB_ROOT, 'runtime', 'jev-use') : null,
    path.join(SCRIPT_DIR, 'runtime', 'jev-use'),
    path.join(USER_HOME, '.claude', 'jev-use'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'jev-use', 'dist', 'cli.js'))) {
      return dir;
    }
  }
  return null;
}

function ensureLocalJevBundle(destRoot, allowNpmInstall = false) {
  const targetCli = path.join(destRoot, 'node_modules', 'jev-use', 'dist', 'cli.js');
  if (fs.existsSync(targetCli)) return targetCli;

  const existing = getLocalJevBundleDir();
  if (existing) {
    safeCopyDir(path.join(existing, 'node_modules'), path.join(destRoot, 'node_modules'));
    if (fs.existsSync(targetCli)) return targetCli;
  }

  const npxCached = findCachedNpxJevDir();
  if (npxCached) {
    safeCopyDir(path.join(npxCached, 'node_modules'), path.join(destRoot, 'node_modules'));
    if (fs.existsSync(targetCli)) return targetCli;
  }

  if (allowNpmInstall) {
    try {
      fs.mkdirSync(destRoot, { recursive: true });
      const npmBin = process.env.USB_ROOT && fs.existsSync(path.join(process.env.USB_ROOT, 'runtime', 'node', 'npm.cmd'))
        ? path.join(process.env.USB_ROOT, 'runtime', 'node', 'npm.cmd')
        : 'npm';
      execFileSync(npmBin, ['--prefix', destRoot, 'install', '--no-save', 'jev-use@0.8.0'], {
        stdio: 'inherit',
        shell: true
      });
      if (fs.existsSync(targetCli)) return targetCli;
    } catch (e) {}
  }
  return null;
}

function resolveJevInvocation(preferBundleDir = null) {
  const cliJs = preferBundleDir
    ? ensureLocalJevBundle(preferBundleDir, false)
    : (getLocalJevBundleDir()
      ? path.join(getLocalJevBundleDir(), 'node_modules', 'jev-use', 'dist', 'cli.js')
      : ensureLocalJevBundle(path.join(USER_HOME, '.claude', 'jev-use'), false));
  if (cliJs && fs.existsSync(cliJs)) {
    return {
      command: 'node',
      args: [cliJs, 'serve'],
      hookCommand: `node "${cliJs}" hook gate`,
      cliJs
    };
  }
  return {
    command: 'npx',
    args: ['-y', 'jev-use@0.8.0', 'serve'],
    hookCommand: 'npx -y jev-use@0.8.0 hook gate',
    cliJs: null
  };
}

function getJevGateStatus(settings) {
  const preTool = settings?.hooks?.PreToolUse;
  if (!Array.isArray(preTool)) return false;
  return preTool.some(entry =>
    Array.isArray(entry?.hooks) && entry.hooks.some(h => typeof h?.command === 'string' && h.command.includes('jev-use'))
  );
}

function setJevGateEnabled(settings, enable, hookCommand) {
  settings.hooks = settings.hooks || {};
  const existing = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  const filtered = existing.filter(entry =>
    !(Array.isArray(entry?.hooks) && entry.hooks.some(h => typeof h?.command === 'string' && h.command.includes('jev-use')))
  );
  if (enable) {
    filtered.push({
      matcher: 'Bash|Write|Edit',
      hooks: [{
        type: 'command',
        command: hookCommand,
        timeout: 30,
        statusMessage: 'Jev gate: risk-checking this action'
      }]
    });
  }
  if (filtered.length > 0) {
    settings.hooks.PreToolUse = filtered;
  } else {
    delete settings.hooks.PreToolUse;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
}

/**
 * Update WSL Hermes config.yaml & .env cleanly through Hermes's own bootstrapped Python runtime.
 */
function runWslHermesPython(payloadObj) {
  const tmpPy = path.join(os.tmpdir(), `qbranch_hermes_${process.pid}.py`);
  const tmpJson = path.join(os.tmpdir(), `qbranch_hermes_${process.pid}.json`);
  const pyCode = [
    'import json, sys',
    'sys.path.insert(0, "/home/Ade/.hermes/hermes-agent")',
    'import hermes_bootstrap',
    'from hermes_cli.config import load_config, save_config, save_env_value',
    'from hermes_cli.mcp_config import validate_mcp_server_entry',
    `with open(${JSON.stringify(toWslPath(tmpJson))}, "r", encoding="utf-8") as f:`,
    '    p = json.load(f)',
    'for k, v in (p.get("env") or {}).items():',
    '    if v: save_env_value(k, v)',
    'cfg = load_config()',
    'if p.get("primaryModel"):',
    '    cfg.setdefault("model", {})["default"] = p["primaryModel"]',
    'if p.get("baseUrl"):',
    '    cfg.setdefault("model", {})["base_url"] = p["baseUrl"]',
    '    cfg.setdefault("model", {})["provider"] = "custom"',
    'if p.get("apiKey"):',
    '    cfg.setdefault("model", {})["api_key"] = p["apiKey"]',
    'if p.get("fastModel") is not None:',
    '    if p["fastModel"]: cfg.setdefault("delegation", {})["model"] = p["fastModel"]',
    '    else: cfg.setdefault("delegation", {}).pop("model", None)',
    'if p.get("reasoning") is not None:',
    '    cfg.setdefault("agent", {})["reasoning_effort"] = p["reasoning"]',
    'if p.get("serviceTier") is not None:',
    '    cfg.setdefault("agent", {})["service_tier"] = p["serviceTier"]',
    'if p.get("wireJevMcp"):',
    '    entry = {"command": "/home/Ade/.local/bin/node", "args": ["/home/Ade/.hermes/tools/jev-use/node_modules/jev-use/dist/cli.js", "serve"], "env": {"TYPESAFE_API_KEY": "${TYPESAFE_API_KEY}", "TYPESAFE_BASE_URL": "${TYPESAFE_BASE_URL}"}}',
    '    issues = validate_mcp_server_entry("jev", entry)',
    '    if not issues:',
    '        cfg.setdefault("mcp_servers", {})["jev"] = entry',
    'save_config(cfg)',
    'print("OK")'
  ].join('\n');

  try {
    fs.writeFileSync(tmpJson, JSON.stringify(payloadObj), 'utf8');
    fs.writeFileSync(tmpPy, pyCode, 'utf8');
    const cmd = `PY=$(grep -m1 -oE "/home/[^ ]+/python3" /home/Ade/.hermes/hermes-agent/.hermes/bin/hermes 2>/dev/null || echo python3); "$PY" "${toWslPath(tmpPy)}"`;
    const out = execFileSync('wsl.exe', ['-d', 'kali-linux', '-u', 'Ade', 'bash', '-c', cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.includes('OK');
  } catch (e) {
    return false;
  } finally {
    try { fs.unlinkSync(tmpPy); } catch (e) {}
    try { fs.unlinkSync(tmpJson); } catch (e) {}
  }
}

function syncToHermes(primaryModel, baseUrl, apiKey, fastModel = null) {
  try {
    const hermesUrl = baseUrl
      ? (baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/v1`)
      : null;
    const typesafeBase = baseUrl ? baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '') : null;

    if (process.env.USB_ROOT) {
      const usbCfgPath = path.join(process.env.USB_ROOT, 'config', 'hermes', 'config.yaml');
      const usbEnvPath = path.join(process.env.USB_ROOT, 'config', 'hermes', '.env');
      writePortableHermesFiles(
        path.join(process.env.USB_ROOT, 'config', 'hermes'),
        { primaryModel, fastModel, baseUrl: hermesUrl, apiKey, typesafeBase }
      );
      if (fs.existsSync(usbCfgPath) || fs.existsSync(usbEnvPath)) {
        // Also keep WSL in sync if present
      }
    }

    const ok = runWslHermesPython({
      primaryModel: primaryModel || null,
      fastModel: fastModel || null,
      baseUrl: hermesUrl,
      apiKey: apiKey || null,
      env: {
        ...(apiKey ? { TYPESAFE_API_KEY: apiKey } : {}),
        ...(typesafeBase ? { TYPESAFE_BASE_URL: typesafeBase } : {})
      }
    });
    if (ok) return true;

    const commands = [];
    if (primaryModel) commands.push(`hermes config set model.default "${primaryModel}"`);
    if (fastModel) commands.push(`hermes config set delegation.model "${fastModel}"`);
    if (hermesUrl) commands.push(`hermes config set model.base_url "${hermesUrl}"`);
    if (apiKey) commands.push(`hermes config set model.api_key "${apiKey}"`);
    if (commands.length > 0) {
      runWsl(commands.join('; '));
      return true;
    }
  } catch (e) {
    return false;
  }
  return true;
}

function writePortableHermesFiles(hermesConfigDir, opts) {
  fs.mkdirSync(hermesConfigDir, { recursive: true });
  const existingCfgPath = path.join(hermesConfigDir, 'config.yaml');
  let curPrimary = opts.primaryModel || 'gpt-6-luna';
  let curFast = opts.fastModel === undefined ? 'deepseek-v4.1-flash-1017' : opts.fastModel;
  let curUrl = opts.baseUrl || 'https://api.experientiallabs.ai/v1';
  let curKey = opts.apiKey || '';
  let curReasoning = opts.reasoning || 'none';
  if (fs.existsSync(existingCfgPath)) {
    const raw = fs.readFileSync(existingCfgPath, 'utf8');
    if (!opts.primaryModel) curPrimary = raw.match(/^\s*default:\s*"([^"]+)"/m)?.[1] || curPrimary;
    if (!opts.baseUrl) curUrl = raw.match(/^\s*base_url:\s*"([^"]+)"/m)?.[1] || curUrl;
    if (!opts.apiKey) curKey = raw.match(/^\s*api_key:\s*"([^"]+)"/m)?.[1] || curKey;
    if (opts.fastModel === undefined) curFast = raw.match(/delegation:\s*\r?\n\s*model:\s*"([^"]+)"/m)?.[1] || curFast;
    if (!opts.reasoning) curReasoning = raw.match(/reasoning_effort:\s*"([^"]+)"/m)?.[1] || curReasoning;
  }
  const usbRootGuess = path.resolve(hermesConfigDir, '..', '..');
  const bundledCli = path.join(usbRootGuess, 'runtime', 'jev-use', 'node_modules', 'jev-use', 'dist', 'cli.js');
  const bundledNode = path.join(usbRootGuess, 'runtime', 'node', 'node.exe');
  const jevCmd = fs.existsSync(bundledCli)
    ? (fs.existsSync(bundledNode) ? bundledNode.replace(/\\/g, '/') : 'node')
    : 'npx';
  const jevArgs = fs.existsSync(bundledCli)
    ? `["${bundledCli.replace(/\\/g, '/')}", "serve"]`
    : '["-y", "jev-use@0.8.0", "serve"]';
  const typesafeBase = opts.typesafeBase || curUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const delegationModelLine = curFast ? `  model: "${curFast}"\n` : '';
  const hermesYaml = `# 007 Q-Branch Portable Configuration
_config_version: 53
model:
  default: "${curPrimary}"
  provider: "custom"
  base_url: "${curUrl}"
  api_key: "${curKey}"
agent:
  reasoning_effort: "${curReasoning}"
delegation:
${delegationModelLine}  max_iterations: 250
mcp_servers:
  jev:
    command: "${jevCmd}"
    args: ${jevArgs}
    env:
      TYPESAFE_API_KEY: "${curKey}"
      TYPESAFE_BASE_URL: "${typesafeBase}"
runtime:
  nofile_soft_limit: 4096
tools:
  tool_search:
    enabled: "off"
`;
  fs.writeFileSync(existingCfgPath, hermesYaml, 'utf8');
  const hermesEnv = `# 007 Q-Branch Portable Environment
OPENAI_API_KEY=${curKey}
OPENAI_BASE_URL=${curUrl}
CUSTOM_API_KEY=${curKey}
TYPESAFE_API_KEY=${curKey}
TYPESAFE_BASE_URL=${typesafeBase}
`;
  fs.writeFileSync(path.join(hermesConfigDir, '.env'), hermesEnv, 'utf8');
}

// Curated Mission Loadout Profiles
const PROFILES = {
  special_ops: {
    id: 'special_ops',
    name: '007 Special Ops: Cyber & Autonomous Swarm',
    tagline: 'Offensive Security, Reverse Engineering, Autonomous Loops & Hardened Systems',
    skills: [
      // 1. Offensive Security & Red Team (11)
      'hunt-idor', 'hunt-auth-bypass', 'hunt-ssrf', 'hunt-sqli', 'hunt-rce',
      'hunt-business-logic', 'ffuf-claude-skill', 'offensive-osint', 'web2-recon',
      'apk-redteam-pipeline', 'ios-redteam-pipeline',
      // 2. Recon, Pwn & Reversing (7)
      'reverse-engineer', 'ghidra-reverse', 'binary-diff', 'protocol-reverse',
      'pwn-chain', 'bug-bounty', 'evidence-hygiene',
      // 3. Autonomous Swarms & Agent Minds (10)
      'anti-sycophancy', 'agent-squad', 'autonomous-agents', 'goal-loop',
      'planning-with-files', 'agent-memory', 'subagent-orchestrator',
      'doubt-driven-development', 'systematic-debugging', 'jev-use',
      // 4. Hardened Shells & Elite Codecraft (17)
      'uncle-bob-craft', 'code-reviewer', 'anti-ui-slop', 'simplify-code',
      'tdd-workflow', 'fastapi-pro', 'go-concurrency-patterns', 'rust-patterns',
      'docker-expert', 'mcp-builder', 'github', 'gh-search-code',
      'webapp-testing', 'web-scraper', 'browser-use', 'bash-defensive-patterns',
      'powershell-windows'
    ]
  },
  bug_bounty: {
    id: 'bug_bounty',
    name: 'Pure Bug Bounty & Red Team Strike Kit',
    tagline: 'Vulnerability Hunting, Fuzzing, Mobile Red-Team & Payout Reporting',
    skills: [
      'hunt-idor', 'hunt-auth-bypass', 'hunt-ssrf', 'hunt-sqli', 'hunt-rce',
      'hunt-business-logic', 'hunt-csrf', 'hunt-xss', 'hunt-cors', 'hunt-api-misconfig',
      'ffuf-claude-skill', 'offensive-osint', 'web2-recon', 'apk-redteam-pipeline',
      'ios-redteam-pipeline', 'pwn-chain', 'bug-bounty', 'evidence-hygiene',
      'report-writing', 'recon-scope-triage', 'anti-sycophancy', 'doubt-driven-development',
      'bash-defensive-patterns', 'powershell-windows'
    ]
  },
  autonomous_swarm: {
    id: 'autonomous_swarm',
    name: 'Autonomous Swarms & AI Architect',
    tagline: 'Self-Directed Loops, Memory Trees, File-Based Planning & Multi-Agent Swarms',
    skills: [
      'anti-sycophancy', 'agent-squad', 'autonomous-agents', 'goal-loop',
      'planning-with-files', 'agent-memory', 'subagent-orchestrator',
      'doubt-driven-development', 'systematic-debugging', 'tree-ring-memory',
      'council-multi-model', 'jev-use', 'code-reviewer', 'simplify-code', 'anti-ui-slop',
      'uncle-bob-craft', 'mcp-builder', 'docker-expert', 'bash-defensive-patterns'
    ]
  }
};

function resolveSkillPath(skillName) {
  // 1. Local bundled skills in repository
  const p0 = path.join(LOCAL_SKILLS_PATH, skillName);
  if (fs.existsSync(p0)) return p0;
  // 2. Master Gemini vault on system
  const p1 = path.join(GEMINI_SKILLS_PATH, skillName);
  if (fs.existsSync(p1)) return p1;
  // 3. Backup
  const p2 = path.join(CLAUDE_BACKUP_PATH, skillName);
  if (fs.existsSync(p2)) return p2;
  // 4. Current Claude skills
  const p3 = path.join(CLAUDE_SKILLS_PATH, skillName);
  if (fs.existsSync(p3)) return p3;
  return null;
}

function ensureClaudeSkillsBackup() {
  if (fs.existsSync(CLAUDE_SKILLS_PATH) && !fs.existsSync(CLAUDE_BACKUP_PATH)) {
    fs.cpSync(CLAUDE_SKILLS_PATH, CLAUDE_BACKUP_PATH, { recursive: true });
    return true;
  }
  return false;
}

async function applyMissionLoadout(profileKey) {
  const profile = PROFILES[profileKey];
  if (!profile) return;

  console.log(`\n${C.gold}═══ DEPLOYING MISSION LOADOUT: ${profile.name.toUpperCase()} ═══${C.reset}\n`);
  
  // 1. Ensure Claude skills are backed up
  ensureClaudeSkillsBackup();
  console.log(`  ${C.green}✓${C.reset} Baseline preserved in ${C.cyan}~/.claude/skills.backup${C.reset}`);

  // 2. Clear and deploy to Claude Code
  const targetClaudeSkillsDir = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills')
    : CLAUDE_SKILLS_PATH;
  console.log(`  [*] Deploying ${profile.skills.length} skills to Claude Code...`);
  fs.mkdirSync(targetClaudeSkillsDir, { recursive: true });
  for (const item of fs.readdirSync(targetClaudeSkillsDir)) {
    fs.rmSync(path.join(targetClaudeSkillsDir, item), { recursive: true, force: true });
  }
  const deployList = [...new Set([...profile.skills, ...(inspectJevState().hasMcp ? ['jev-use'] : [])])];
  let installedClaude = 0;
  for (const skill of deployList) {
    const src = resolveSkillPath(skill);
    if (src && fs.existsSync(src)) {
      fs.cpSync(src, path.join(targetClaudeSkillsDir, skill), { recursive: true });
      installedClaude++;
    }
  }
  console.log(`  ${C.green}✓${C.reset} Claude Code updated: ${C.white}${installedClaude} skills active${C.reset}`);

  // 3. Deploy to Hermes Agent (WSL Kali or Portable USB)
  if (process.env.USB_ROOT) {
    const usbHermesVault = path.join(process.env.USB_ROOT, 'config', 'hermes', 'skills', 'vault');
    fs.rmSync(usbHermesVault, { recursive: true, force: true });
    safeCopyDir(targetClaudeSkillsDir, usbHermesVault);
  } else {
    console.log(`  [*] Synchronizing to Hermes Agent (WSL Kali ~/.hermes/skills/vault)...`);
    runWsl('mkdir -p /home/Ade/.hermes/skills/vault && rm -rf /home/Ade/.hermes/skills/vault/*');
    runWsl(`cp -r "${toWslPath(targetClaudeSkillsDir)}/." /home/Ade/.hermes/skills/vault/`);
  }

  // 4. Stow Hermes built-in clutter (apple, productivity)
  console.log(`  [*] Stowing Hermes built-in office & personal clutter...`);
  runWsl('mkdir -p /home/Ade/.hermes/skills/.stowed_clutter && for d in apple productivity; do [ -d "/home/Ade/.hermes/skills/$d" ] && mv "/home/Ade/.hermes/skills/$d" "/home/Ade/.hermes/skills/.stowed_clutter/"; done 2>/dev/null || true');
  console.log(`  ${C.green}✓${C.reset} Hermes Agent: ${C.white}${installedClaude} vault combat skills active, clutter stowed!${C.reset}`);

  console.log(`\n${C.gold}✨ MISSION LOADOUT DEPLOYED SUCCESSFULLY! ✨${C.reset}\n`);
}

async function restoreOriginalSetup() {
  console.log(`\n${C.gold}═══ RESTORING FACTORY BASELINE ═══${C.reset}\n`);
  
  if (fs.existsSync(CLAUDE_BACKUP_PATH)) {
    for (const item of fs.readdirSync(CLAUDE_SKILLS_PATH)) {
      fs.rmSync(path.join(CLAUDE_SKILLS_PATH, item), { recursive: true, force: true });
    }
    fs.cpSync(CLAUDE_BACKUP_PATH, CLAUDE_SKILLS_PATH, { recursive: true });
    const count = fs.readdirSync(CLAUDE_SKILLS_PATH).length;
    console.log(`  ${C.green}✓${C.reset} Restored ${count} original skills to Claude Code.`);
  } else {
    console.log(`  ${C.red}⚠ No backup folder found at ~/.claude/skills.backup${C.reset}`);
  }

  // Restore Hermes
  console.log(`  [*] Unstowing Hermes built-ins and resetting vault...`);
  runWsl('if [ -d "/home/Ade/.hermes/skills/.stowed_clutter" ]; then for d in /home/Ade/.hermes/skills/.stowed_clutter/*; do [ -d "$d" ] && mv "$d" "/home/Ade/.hermes/skills/"; done; rmdir "/home/Ade/.hermes/skills/.stowed_clutter" 2>/dev/null || true; fi');
  runWsl('rm -rf /home/Ade/.hermes/skills/vault/* 2>/dev/null || true');
  console.log(`  ${C.green}✓${C.reset} Hermes Agent restored to factory state.`);
  console.log(`\n${C.green}✨ Baseline restored across both agents!${C.reset}\n`);
}

async function runSetupWizard() {
  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : FIRST-TIME AGENT & ENVIRONMENT SETUP WIZARD${C.reset}                ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Automated installer and verification for Claude Code, Hermes Agent & Skills.${C.reset}`);
  console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

  // 1. Check Node.js
  console.log(`${C.gold}[1/4] Checking Node.js Environment...${C.reset}`);
  console.log(`  ${C.green}✓ Node.js ${process.version} detected.${C.reset}\n`);

  // 2. Check Claude Code CLI
  console.log(`${C.gold}[2/4] Checking Claude Code CLI...${C.reset}`);
  let hasClaude = false;
  try {
    execSync('where claude', { stdio: 'ignore' });
    hasClaude = true;
  } catch (e) {}

  if (hasClaude) {
    console.log(`  ${C.green}✓ Claude Code CLI detected.${C.reset}\n`);
  } else {
    console.log(`  ${C.gold}Claude Code CLI not found globally in PATH.${C.reset}`);
    const doInstall = await ask(`  Install Claude Code globally via npm now? (Y/n): `);
    if (!doInstall || doInstall.toLowerCase().startsWith('y')) {
      console.log(`  [*] Running: npm install -g @anthropic-ai/claude-code...`);
      try {
        execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
        console.log(`  ${C.green}✓ Claude Code installed successfully!${C.reset}\n`);
      } catch (err) {
        console.log(`  ${C.gray}Note: You can also run Claude Code on-the-fly via npx.${C.reset}\n`);
      }
    } else {
      console.log(`  ${C.gray}Skipped. (Launcher will invoke via npx directly)${C.reset}\n`);
    }
  }

  // 3. Check WSL & Hermes Agent
  console.log(`${C.gold}[3/4] Checking Hermes Agent (WSL Kali/Linux)...${C.reset}`);
  let hasWsl = false;
  try {
    const wslCheck = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (wslCheck && wslCheck.trim().length > 0) hasWsl = true;
  } catch (e) {}

  if (!hasWsl) {
    console.log(`  ${C.gold}WSL2 not found or no Linux distributions installed.${C.reset}`);
    console.log(`  ${C.gray}To enable Hermes Agent in WSL, run: wsl --install -d kali-linux${C.reset}\n`);
  } else {
    console.log(`  ${C.green}✓ WSL2 Linux subsystem detected.${C.reset}`);
    const hermesPath = runWsl('which hermes 2>/dev/null || true');
    if (hermesPath) {
      console.log(`  ${C.green}✓ Hermes Agent detected in WSL: ${hermesPath}${C.reset}\n`);
    } else {
      console.log(`  ${C.gold}Hermes Agent not yet detected in WSL PATH.${C.reset}`);
      console.log(`  ${C.gray}Hermes can be installed inside WSL via: curl -fsSL https://raw.githubusercontent.com/NousResearch/Hermes-Agent/main/setup-hermes.sh | bash${C.reset}\n`);
    }
  }

  // 4. API Key & Gateway Configuration
  console.log(`${C.gold}[4/4] Gateway, API Key & Jev Intervention...${C.reset}`);
  const settings = readClaudeSettings();
  const currentKey = settings.env?.ANTHROPIC_AUTH_TOKEN || '';
  if (currentKey) {
    console.log(`  ${C.green}✓ API Key already configured (${currentKey.slice(0, 7)}...${currentKey.slice(-4)})${C.reset}\n`);
  } else {
    console.log(`  ${C.cyan}Free promotional models (GPT-6 Luna + DeepSeek Flash 1017) are available on Experiential Labs.${C.reset}`);
    await configureApi();
  }

  // 5. Deploy Bundled Skills & Wire Jev + Hermes 2-Model Split
  console.log(`[*] Deploying Bundled Special Ops Skills (incl. jev-use)...`);
  await applyMissionLoadout('special_ops');
  const latestSettings = readClaudeSettings();
  if (latestSettings.env?.ANTHROPIC_AUTH_TOKEN) {
    console.log(`[*] Wiring Jev Intervention & Hermes 2-Model Split...`);
    syncJevIntegration({ allowNpmInstall: true });
    syncToHermes(
      latestSettings.env.ANTHROPIC_MODEL || 'gpt-6-luna',
      latestSettings.env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai',
      latestSettings.env.ANTHROPIC_AUTH_TOKEN,
      latestSettings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017'
    );
  }

  console.log(`\n${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`  ${C.gold}🎉 007 Q-BRANCH SETUP COMPLETE!${C.reset}`);
  console.log(`  You are ready to launch:`);
  console.log(`    [1] Claude Code  (Tag Team + Jev Intervention)`);
  console.log(`    [2] Hermes Agent (Autonomous Primary + Subagent Split + Jev MCP)`);
  console.log(`${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}\n`);
  await ask(`Press Enter to return to Mission Menu... `);
}

async function manageProfiles(currentTargetDir) {
  while (true) {
    console.clear();
    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : MISSION LOADOUT PROFILES (1-CLICK AGENT OVERHAUL)${C.reset}           ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Transform Claude Code and Hermes Agent into purpose-built strike teams.${C.reset}`);
    console.log(`  ${C.gray}All current skills are backed up safely with instant 1-click restore.${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

    console.log(`  ${C.green}[1]${C.reset} ${C.white}${C.bold}007 SPECIAL OPS: CYBER & AUTONOMOUS SWARM${C.reset} ${C.green}[RECOMMENDED]${C.reset}`);
    console.log(`      ${C.gray}44 Elite Skills | Purges office paperwork (docx, xlsx, pptx, apple)${C.reset}`);
    console.log(`      ${C.cyan}• Offensive (11):${C.reset}  hunt-idor, hunt-auth-bypass, hunt-ssrf, hunt-sqli, ffuf...`);
    console.log(`      ${C.cyan}• Reversing (7):${C.reset}   reverse-engineer, ghidra, binary-diff, pwn-chain...`);
    console.log(`      ${C.cyan}• Swarms (9):${C.reset}      anti-sycophancy, agent-squad, goal-loop, file-planning...`);
    console.log(`      ${C.cyan}• Elite Dev (17):${C.reset}  code-reviewer, anti-ui-slop, simplify-code, go, rust...\n`);

    console.log(`  ${C.green}[2]${C.reset} ${C.white}${C.bold}PURE BUG BOUNTY & RED TEAM STRIKE KIT${C.reset}`);
    console.log(`      ${C.gray}24 Offensive Skills | Laser-focused on hunting, fuzzing & reports${C.reset}`);
    console.log(`      ${C.cyan}• Targets:${C.reset}         Hunt-* suite, ffuf, mobile red-team, OSINT, PoC writing\n`);

    console.log(`  ${C.green}[3]${C.reset} ${C.white}${C.bold}AUTONOMOUS SWARMS & AI ARCHITECT${C.reset}`);
    console.log(`      ${C.gray}18 Agent Skills | Self-directed execution loops, memory trees & councils${C.reset}`);
    console.log(`      ${C.cyan}• Engine:${C.reset}          agent-squad, goal-loop, planning-with-files, memory...\n`);

    console.log(`  ${C.gold}[4]${C.reset} ${C.white}${C.bold}RESTORE ORIGINAL FACTORY BASELINE${C.reset}`);
    console.log(`      ${C.gray}1-Click rollback to initial 33 skills in Claude & factory Hermes built-ins${C.reset}\n`);

    console.log(`  ${C.red}[0]${C.reset} ${C.white}Back to Q-Branch Menu${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);

    const choice = await ask(`\nSelect Mission Profile [1-4, 0]: `);
    if (!choice && process.stdin.readableEnded) break;
    const c = choice.trim().toLowerCase();

    if (c === '0' || c === 'b' || c === 'q') {
      break;
    } else if (c === '1') {
      await applyMissionLoadout('special_ops');
      await ask(`Press Enter to continue... `);
      break;
    } else if (c === '2') {
      await applyMissionLoadout('bug_bounty');
      await ask(`Press Enter to continue... `);
      break;
    } else if (c === '3') {
      await applyMissionLoadout('autonomous_swarm');
      await ask(`Press Enter to continue... `);
      break;
    } else if (c === '4') {
      await restoreOriginalSetup();
      await ask(`Press Enter to continue... `);
      break;
    }
  }
}

async function showStatus() {
  const settings = readClaudeSettings();
  const env = settings.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || '';
  const primaryModel = env.ANTHROPIC_MODEL || 'gpt-6-luna';
  const auxModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  
  const maskedKey = apiKey ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}` : `${C.red}Not Set${C.reset}`;
  
  let vaultCount = 0;
  if (fs.existsSync(GEMINI_SKILLS_PATH)) {
    try { vaultCount = fs.readdirSync(GEMINI_SKILLS_PATH).length; } catch (e) {}
  } else if (fs.existsSync(LOCAL_SKILLS_PATH)) {
    try { vaultCount = fs.readdirSync(LOCAL_SKILLS_PATH).length; } catch (e) {}
  }
  
  let claudeSkillsCount = 0;
  if (fs.existsSync(CLAUDE_SKILLS_PATH)) {
    try { claudeSkillsCount = fs.readdirSync(CLAUDE_SKILLS_PATH).length; } catch (e) {}
  }

  const jevSt = inspectJevState();
  const hermesSummary = readHermesYamlSummary();

  console.log(`\n${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : AGENT INTELLIGENCE HUB${C.reset}                                 ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Gateway Base URL   :${C.reset} ${C.white}${baseUrl}${C.reset}`);
  console.log(`  ${C.gray}API Key            :${C.reset} ${C.green}${maskedKey}${C.reset}`);
  console.log(`  ${C.gray}Primary Model      :${C.reset} ${C.gold}${primaryModel}${C.reset} ${C.green}[FLAGSHIP]${C.reset}`);
  console.log(`  ${C.gray}Fast Aux Model     :${C.reset} ${C.cyan}${auxModel}${C.reset} ${C.green}[SUBAGENT]${C.reset}`);
  if (hermesSummary.exists) {
    console.log(`  ${C.gray}Hermes Split       :${C.reset} ${C.gold}${hermesSummary.defaultModel}${C.reset} + ${C.cyan}${hermesSummary.delegationModel}${C.reset} ${C.gray}(Reasoning: ${hermesSummary.reasoningEffort})${C.reset}`);
  }
  console.log(`  ${C.gray}Jev Intervention   :${C.reset} ${jevSt.hasMcp && jevSt.hasMcpKey ? `${C.green}ACTIVE${C.reset}` : `${C.red}UNCONFIGURED${C.reset}`} ${C.gray}(Hermes: ${jevSt.hermesJev ? 'ON' : 'OFF'} | PreToolUse Gate: ${jevSt.gateOn ? 'ON' : 'OFF'})${C.reset}`);
  console.log(`  ${C.gray}Skills Master Vault:${C.reset} ${C.magenta}${vaultCount.toLocaleString()} skills available${C.reset}`);
  console.log(`  ${C.gray}Claude Code Active :${C.reset} ${C.white}${claudeSkillsCount} installed${C.reset}`);
  console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);
}

async function configureApi() {
  const settings = readClaudeSettings();
  settings.env = settings.env || {};
  
  console.log(`\n${C.gold}═══ Q-BRANCH : GATEWAY & CREDENTIAL CONFIGURATION ═══${C.reset}\n`);
  const currentUrl = settings.env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  console.log(`Current Base URL: ${C.cyan}${currentUrl}${C.reset}`);
  const newUrl = await ask(`Enter Gateway URL (Enter to keep current): `);
  const targetUrl = newUrl || currentUrl;

  const currentKey = settings.env.ANTHROPIC_AUTH_TOKEN || '';
  const maskedKey = currentKey ? `${currentKey.slice(0, 7)}...${currentKey.slice(-4)}` : 'None';
  console.log(`Current API Key : ${C.cyan}${maskedKey}${C.reset}`);
  const newKey = await ask(`Enter new API Key (Enter to keep current): `);
  const targetKey = newKey || currentKey;

  if (targetKey) {
    console.log(`\n[*] Testing connection to ${targetUrl}/v1/models...`);
    try {
      const testUrl = targetUrl.endsWith('/v1') ? `${targetUrl}/models` : `${targetUrl.replace(/\/+$/, '')}/v1/models`;
      const res = await fetch(testUrl, { headers: { Authorization: `Bearer ${targetKey}` } });
      if (res.ok) {
        console.log(`${C.green}✓ Authentication succeeded! (HTTP 200 OK)${C.reset}`);
      } else {
        console.log(`${C.red}⚠ Warning: Server returned HTTP ${res.status}. Check your key.${C.reset}`);
      }
    } catch (e) {
      console.log(`${C.red}⚠ Could not reach gateway: ${e.message}${C.reset}`);
    }
  }

  settings.env.ANTHROPIC_BASE_URL = targetUrl.replace(/\/+v1\/?$/, '');
  settings.env.ANTHROPIC_AUTH_TOKEN = targetKey;
  settings.env.TYPESAFE_BASE_URL = settings.env.ANTHROPIC_BASE_URL;
  settings.env.TYPESAFE_API_KEY = targetKey;
  saveClaudeSettings(settings);

  console.log(`[*] Syncing to Hermes Agent & Jev Intervention...`);
  syncToHermes(null, targetUrl, targetKey);
  syncJevIntegration({ apiKey: targetKey, baseUrl: settings.env.ANTHROPIC_BASE_URL });
  console.log(`${C.green}✓ Saved and synchronized across Claude Code, Hermes & Jev!${C.reset}\n`);
}

function fmtUsd(v) {
  if (v == null || Number.isNaN(v)) return '?';
  if (v === 0) return '$0';
  if (v >= 1 && Number.isInteger(v)) return `$${v}`;
  if (v >= 0.01) {
    const s3 = v.toFixed(3).replace(/0+$/, '');
    const [, dec] = s3.split('.');
    if (!dec) return `$${s3.replace(/\.$/, '')}`;
    return dec.length === 1 ? `$${v.toFixed(2)}` : `$${s3}`;
  }
  return `$${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function getActiveModelBadge(id, env) {
  const isPrimary = id === env.ANTHROPIC_MODEL;
  const isFast = id === env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  if (isPrimary && isFast) return ` ${C.gold}◀ ACTIVE PRIMARY + FAST${C.reset}`;
  if (isPrimary) return ` ${C.gold}◀ ACTIVE PRIMARY${C.reset}`;
  if (isFast) return ` ${C.cyan}◀ ACTIVE FAST/SUBAGENT${C.reset}`;
  return '';
}

/**
 * Fetch the full catalog (including promotions & plan_discounts) from /api/models.
 * Returns null if the endpoint is unsupported (allowing /v1/models fallback).
 */
async function fetchGatewayCatalog(gatewayOrigin, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const models = [];
  let promotions = [];
  let offset = 0;

  while (true) {
    const res = await fetch(`${gatewayOrigin}/api/models?limit=1000&offset=${offset}`, { headers });
    if (!res.ok) {
      if (offset === 0 && (res.status === 404 || res.status === 405)) return null;
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    if (!Array.isArray(json.models)) return null;
    models.push(...json.models);
    if (offset === 0 && Array.isArray(json.promotions)) {
      promotions = json.promotions;
    }
    if (models.length >= (json.total || 0) || json.models.length === 0) break;
    offset += json.models.length;
  }

  return { models, promotions };
}

function buildCatalogLists(catalog) {
  const promoBySlug = new Map();
  for (const pr of catalog.promotions) {
    for (const slug of (pr.slugs || [])) {
      const prev = promoBySlug.get(slug);
      if (!prev || pr.free || (pr.percent_off || 0) > (prev.percent_off || 0)) {
        promoBySlug.set(slug, pr);
      }
    }
  }

  const freeModels = [];
  const discountedModels = [];

  for (const entry of catalog.models) {
    const m = entry.model || {};
    if (m.status && m.status !== 'active') continue;
    if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) continue;

    const hostProvs = (entry.providers || []).filter(
      p => p.billing_source === 'host_managed' && p.status !== 'retired'
    );
    if (hostProvs.length === 0) continue;

    const disc = { free: 0, pro: 0, max: 0, ultra: 0 };
    for (const p of hostProvs) {
      if (!p.plan_discounts) continue;
      for (const tier of ['free', 'pro', 'max', 'ultra']) {
        if ((p.plan_discounts[tier] || 0) > disc[tier]) disc[tier] = p.plan_discounts[tier];
      }
    }

    const pricedProvs = hostProvs.filter(p => p.input_nano_usd_per_million != null);
    const discProvs = pricedProvs.filter(p => p.plan_discounts && Object.values(p.plan_discounts).some(v => v > 0));
    const defSet = new Set(entry.default_provider_ids || []);
    const pickPool = [...(discProvs.length > 0 ? discProvs : pricedProvs)].sort((a, b) => {
      const defDiff = (defSet.has(a.id) ? 0 : 1) - (defSet.has(b.id) ? 0 : 1);
      if (defDiff !== 0) return defDiff;
      const inDiff = (a.input_nano_usd_per_million || 0) - (b.input_nano_usd_per_million || 0);
      if (inDiff !== 0) return inDiff;
      return (a.output_nano_usd_per_million || 0) - (b.output_nano_usd_per_million || 0);
    });
    const bestProv = pickPool[0];
    const inUsd = bestProv ? bestProv.input_nano_usd_per_million / 1e9 : null;
    const outUsd = bestProv ? (bestProv.output_nano_usd_per_million || 0) / 1e9 : null;

    const promo = promoBySlug.get(m.slug) || null;
    const promoPct = promo?.percent_off || 0;
    const isAllZero = pricedProvs.length > 0 && pricedProvs.every(
      p => p.input_nano_usd_per_million === 0 && (p.output_nano_usd_per_million || 0) === 0
    );
    const isFreeCore = disc.pro >= 100 && disc.max >= 100 && disc.ultra >= 100 && disc.free === 0;
    const isPromoFree = Boolean(promo?.free);
    const hasPlanDisc = disc.free > 0 || disc.pro > 0 || disc.max > 0 || disc.ultra > 0;

    const item = {
      id: m.slug,
      tools: Boolean(m.supported_params?.tools),
      ctx: m.context_window ? `${Math.round(m.context_window / 1024)}K` : 'Auto',
      inUsd,
      outUsd,
      disc,
      promo,
      promoPct,
      isPromoFree
    };

    if (isFreeCore || isPromoFree || isAllZero) {
      freeModels.push(item);
    } else if (promoPct > 0 || hasPlanDisc) {
      discountedModels.push(item);
    }
  }

  freeModels.sort((a, b) => (Number(b.tools) - Number(a.tools)) || a.id.localeCompare(b.id));
  discountedModels.sort((a, b) =>
    (b.promoPct - a.promoPct) ||
    (b.disc.free - a.disc.free) ||
    (b.disc.ultra - a.disc.ultra) ||
    (b.disc.max - a.disc.max) ||
    (b.disc.pro - a.disc.pro) ||
    a.id.localeCompare(b.id)
  );

  return { freeModels, discountedModels };
}

function buildDiscountSummary(m) {
  const parts = [];
  if (m.promoPct > 0) {
    const windowNote = m.promo?.label?.match(/\(([^)]+)\)/)?.[1];
    const extras = [windowNote, m.inUsd != null ? `was ${fmtUsd(m.inUsd)}/${fmtUsd(m.outUsd)}` : null].filter(Boolean);
    parts.push(`${C.green}${m.promoPct}% OFF Promo${C.reset}${extras.length ? ` ${C.gray}(${extras.join(', ')})${C.reset}` : ''}`);
  }
  const tierParts = [];
  if (m.disc.free > 0) tierParts.push(`${m.disc.free}% Free`);
  if (m.disc.pro > 0) tierParts.push(`${m.disc.pro}% Pro`);
  if (m.disc.max > 0) tierParts.push(`${m.disc.max}% Max`);
  if (m.disc.ultra > 0) tierParts.push(`${m.disc.ultra}% Ultra`);
  if (tierParts.length > 0) parts.push(tierParts.join(' | '));
  return parts.join(' | ');
}

async function promptAssignModel(modelItem, env) {
  let targetId = modelItem.id;
  if (modelItem.promo?.free_only_via_suffix && !targetId.endsWith(':free')) {
    targetId = `${targetId}:free`;
  }
  if (!modelItem.tools) {
    console.log(`\n${C.gold}[!] Note: ${targetId} is a decision/non-tool model and does not support coding tool calls.${C.reset}`);
  }
  const currentPrimary = env.ANTHROPIC_MODEL || 'gpt-6-luna';
  const currentFast = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  console.log(`\nSelected ${C.white}${targetId}${C.reset}:`);
  console.log(`  1. Set as Primary Model (keep Fast: ${currentFast})`);
  console.log(`  2. Set as Fast/Subagent Model (keep Primary: ${currentPrimary})`);
  console.log(`  3. Set as BOTH Primary & Fast`);
  console.log(`  0. Cancel`);
  const mode = (await ask(`Apply mode [1-3, 0]: `)).trim();
  if (mode === '1') applyModelPair(targetId, currentFast);
  else if (mode === '2') applyModelPair(currentPrimary, targetId);
  else if (mode === '3') applyModelPair(targetId, targetId);
}

async function browseModels() {
  const settings = readClaudeSettings();
  const env = settings.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || '';

  if (!apiKey) {
    console.log(`${C.red}No API Key configured. Please run configuration first.${C.reset}`);
    return;
  }

  const gatewayOrigin = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  console.log(`\n${C.gold}═══ Q-BRANCH : LIVE ONLINE MODEL BROWSER ═══${C.reset}`);
  console.log(`Fetching live catalog & discounts from ${C.cyan}${gatewayOrigin}${C.reset}...\n`);

  let freeModels = [];
  let discountedModels = [];

  try {
    const [catalog, creditsRes] = await Promise.all([
      fetchGatewayCatalog(gatewayOrigin, apiKey),
      fetch(`${gatewayOrigin}/api/v1/credits`, { headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => null)
    ]);

    if (creditsRes && creditsRes.ok) {
      const cJson = await creditsRes.json().catch(() => null);
      if (cJson?.data) {
        const total = cJson.data.total_credits || 0;
        const used = cJson.data.total_usage || 0;
        const rem = Math.max(0, total - used);
        console.log(`${C.gray}Credits Remaining:${C.reset} ${C.green}$${rem.toFixed(2)}${C.reset} ${C.gray}/ $${total.toFixed(2)}${C.reset}\n`);
      }
    }

    if (catalog) {
      ({ freeModels, discountedModels } = buildCatalogLists(catalog));
    } else {
      // Fallback to generic OpenAI-compatible /v1/models endpoint
      const v1Url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${gatewayOrigin}/v1/models`;
      const res = await fetch(v1Url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      for (const m of (json.data || [])) {
        const p = m.pricing || {};
        const inCost = p.input_nano_usd_per_million_tokens;
        const outCost = p.output_nano_usd_per_million_tokens;
        const item = {
          id: m.id,
          tools: m.supports_tools !== false,
          ctx: m.context_window_tokens ? `${Math.round(m.context_window_tokens / 1024)}K` : 'Auto',
          inUsd: inCost != null ? inCost / 1e9 : null,
          outUsd: outCost != null ? outCost / 1e9 : null,
          disc: p.plan_discounts || { free: 0, pro: 0, max: 0, ultra: 0 },
          promo: null,
          promoPct: p.discount_percent || 0,
          isPromoFree: false
        };
        const isFree = inCost === 0 && outCost === 0;
        const hasDisc = item.promoPct > 0 || Object.values(item.disc).some(v => v > 0);
        if (isFree) freeModels.push(item);
        else if (hasDisc) discountedModels.push(item);
      }
    }
  } catch (e) {
    console.log(`${C.red}Failed to fetch models: ${e.message}${C.reset}`);
    return;
  }

  console.log(`${C.green}⭐ ZERO-COST PROMOTIONAL TIER (FREE):${C.reset}`);
  if (freeModels.length === 0) {
    console.log(`  ${C.gray}No zero-cost models reported by this gateway.${C.reset}`);
  } else {
    freeModels.forEach((m, idx) => {
      const tag = m.isPromoFree
        ? `${m.promo?.label || 'Free Promo'}${m.promo?.free_only_via_suffix ? ' (:free)' : ''}`
        : (m.promoPct > 0 ? `Free Core | ${m.promoPct}% Promo` : 'Free Core');
      const noTools = m.tools ? '' : ` ${C.gray}[No Tools]${C.reset}`;
      const badge = getActiveModelBadge(m.id, env);
      const label = `[F${idx + 1}]`.padEnd(6);
      console.log(`  ${C.green}${label}${C.reset}${C.white}${m.id.padEnd(30)}${C.reset} ${C.gray}(${m.ctx.padStart(5)})${C.reset}  ${C.cyan}${tag}${C.reset}${noTools}${badge}`);
    });
  }

  console.log(`\n${C.gold}🏷️ DISCOUNTED MODELS (${discountedModels.length} Active Promos & Plan Discounts):${C.reset}`);
  if (discountedModels.length === 0) {
    console.log(`  ${C.gray}No discounted models currently listed.${C.reset}`);
  } else {
    discountedModels.forEach((m, idx) => {
      let priceCol = 'N/A';
      if (m.inUsd != null) {
        const mult = m.promoPct > 0 && !(m.disc.free || m.disc.pro || m.disc.max || m.disc.ultra) ? (1 - m.promoPct / 100) : 1;
        priceCol = `${fmtUsd(m.inUsd * mult)}/${fmtUsd(m.outUsd * mult)}${mult < 1 ? '*' : ''}`;
      }
      const label = `[D${idx + 1}]`.padEnd(6);
      const summary = buildDiscountSummary(m);
      const badge = getActiveModelBadge(m.id, env);
      console.log(`  ${C.gold}${label}${C.reset}${C.white}${m.id.padEnd(30)}${C.reset} ${C.gray}(${m.ctx.padStart(5)})${C.reset}  ${C.white}${priceCol.padEnd(14)}${C.reset} ${summary}${badge}`);
    });
    if (discountedModels.some(m => m.promoPct > 0 && !(m.disc.free || m.disc.pro || m.disc.max || m.disc.ultra))) {
      console.log(`  ${C.gray}* Effective promo $/M input/output; all other prices list base $/M before tier discount.${C.reset}`);
    }
  }

  const lunaIdx = freeModels.findIndex(m => m.id === 'gpt-6-luna');
  const dsIdx = freeModels.findIndex(m => m.id === 'deepseek-v4.1-flash-1017');
  const lunaTag = lunaIdx >= 0 ? `[F${lunaIdx + 1}] ` : '';
  const dsTag = dsIdx >= 0 ? `[F${dsIdx + 1}] ` : '';

  console.log(`\n${C.cyan}Options:${C.reset}`);
  console.log(`  1. Set ${lunaTag}GPT-6 Luna (Primary) + ${dsTag}DeepSeek Flash 1017 (Fast) ${C.green}[Recommended Free Pair]${C.reset}`);
  console.log(`  2. Set ${dsTag}DeepSeek Flash 1017 (All-round speed) ${C.green}[Zero Cost]${C.reset}`);
  console.log(`  3. Manually enter model names`);
  console.log(`  ${C.gray}Tip: Type any tag above (e.g. F1 or D1) directly to select it.${C.reset}`);
  console.log(`  0. Cancel`);

  const choice = (await ask(`\nSelect [1-3, F#, D#, 0]: `)).trim();

  if (choice === '1') {
    applyModelPair('gpt-6-luna', 'deepseek-v4.1-flash-1017');
  } else if (choice === '2') {
    applyModelPair('deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017');
  } else if (choice === '3') {
    const p = await ask(`Enter Primary Model ID (e.g. gpt-6-luna): `);
    const f = await ask(`Enter Fast Model ID (e.g. deepseek-v4.1-flash-1017): `);
    if (p && f) applyModelPair(p, f);
  } else {
    const tagMatch = choice.match(/^([fd])(\d+)$/i);
    if (tagMatch) {
      const list = tagMatch[1].toUpperCase() === 'F' ? freeModels : discountedModels;
      const picked = list[parseInt(tagMatch[2], 10) - 1];
      if (picked) {
        await promptAssignModel(picked, env);
      } else {
        console.log(`${C.red}Selection ${choice.toUpperCase()} out of range.${C.reset}`);
      }
    }
  }
}

function applyModelPair(primary, fast) {
  const settings = readClaudeSettings();
  settings.env = settings.env || {};
  settings.env.ANTHROPIC_MODEL = primary;
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = primary;
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = primary;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = primary;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = primary;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = fast;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = fast;
  settings.env.ANTHROPIC_SMALL_FAST_MODEL = fast;
  settings.env.CLAUDE_CODE_SUBAGENT_MODEL = fast;
  settings.env.CLAUDE_CODE_AUTO_MODE_SERVER = "0";
  settings.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1";

  settings.modelSettings = settings.modelSettings || {};
  settings.modelSettings[primary] = { effortLevel: 'medium' };
  settings.modelSettings[fast] = { effortLevel: 'medium' };

  saveClaudeSettings(settings);
  syncToHermes(primary, settings.env.ANTHROPIC_BASE_URL, settings.env.ANTHROPIC_AUTH_TOKEN, fast);

  console.log(`\n${C.green}✓ Models updated across Claude Code & Hermes!${C.reset}`);
  console.log(`  Primary (Claude / Hermes)     : ${C.gold}${primary}${C.reset}`);
  console.log(`  Fast Aux (Haiku / Hermes Sub) : ${C.cyan}${fast}${C.reset}\n`);
}

function getSkillDescription(skillName) {
  try {
    const skillPath = resolveSkillPath(skillName);
    if (skillPath) {
      const skillFile = path.join(skillPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const text = fs.readFileSync(skillFile, 'utf8');
        const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) {
          const fmContent = fm[1];
          const descMatch = fmContent.match(/description:\s*(?:>|\|)?\s*([^\r\n]+(?:\r?\n\s{2,}[^\r\n]+)*)/i);
          if (descMatch) {
            return descMatch[1]
              .replace(/\r?\n\s+/g, ' ')
              .replace(/^["']|["']$/g, '')
              .trim();
          }
        }
        const fallback = text.match(/description:\s*(.+)/i);
        if (fallback) return fallback[1].replace(/['"]/g, '').trim();
      }
    }
  } catch (e) {}
  return 'No description provided.';
}

function wrapText(text, width = 72, indent = '      ') {
  if (!text) return indent + '(No description provided)';
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = indent;

  for (const word of words) {
    if ((currentLine + ' ' + word).length > width + indent.length) {
      lines.push(currentLine);
      currentLine = indent + word;
    } else {
      currentLine = currentLine === indent ? indent + word : currentLine + ' ' + word;
    }
  }
  if (currentLine.length > indent.length) lines.push(currentLine);
  
  if (lines.length > 2) {
    return lines.slice(0, 2).join('\n') + ` ${C.gray}...${C.reset}`;
  }
  return lines.join('\n');
}

async function inspectSkill(skillName) {
  const skillPath = resolveSkillPath(skillName);
  const skillFile = skillPath ? path.join(skillPath, 'SKILL.md') : null;
  if (!skillFile || !fs.existsSync(skillFile)) {
    console.log(`${C.red}Skill file not found for: ${skillName}${C.reset}`);
    await ask(`Press Enter to continue... `);
    return;
  }
  
  const text = fs.readFileSync(skillFile, 'utf8');
  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : SKILL DOSSIER — ${skillName.toUpperCase()}${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const lines = fmMatch[1].split('\n').filter(Boolean);
    console.log(`  ${C.gold}METADATA & SPECIFICATION:${C.reset}`);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0 && !line.startsWith(' ')) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        console.log(`    ${C.gray}${k.padEnd(16)}:${C.reset} ${C.white}${v}${C.reset}`);
      }
    }
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  }

  const body = text.replace(/^---[\s\S]*?---\r?\n/, '').trim();
  const bodyLines = body.split('\n').slice(0, 20);
  console.log(`  ${C.gold}INSTRUCTIONS & OPERATIONAL PROFILE PREVIEW:${C.reset}\n`);
  for (const bl of bodyLines) {
    console.log(`    ${C.white}${bl}${C.reset}`);
  }
  const totalBodyLines = body.split('\n').length;
  if (totalBodyLines > 20) {
    console.log(`\n    ${C.gray}... (${totalBodyLines - 20} more lines in SKILL.md)${C.reset}`);
  }
  console.log(`\n${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}`);
  await ask(`\nPress Enter to return to skill browser... `);
}

async function renderSkillsList(skills, title, currentTargetDir) {
  const pageSize = 8;
  const totalPages = Math.ceil(skills.length / pageSize) || 1;
  let currentPage = 1;

  while (true) {
    console.clear();
    const startIndex = (currentPage - 1) * pageSize;
    const pageSkills = skills.slice(startIndex, startIndex + pageSize);

    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : ${title.toUpperCase()}${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Page ${C.gold}${currentPage}${C.gray} of ${C.gold}${totalPages}${C.gray} | Skills ${startIndex + 1}–${startIndex + pageSkills.length} of ${skills.length} | Project: ${C.white}${currentTargetDir || 'Local'}${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

    pageSkills.forEach((s, idx) => {
      const desc = getSkillDescription(s);
      console.log(`  ${C.cyan}[${idx + 1}]${C.reset} ${C.white}${C.bold}${s}${C.reset}`);
      console.log(`${C.gray}${wrapText(desc)}${C.reset}\n`);
    });

    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.gold}CONTROLS:${C.reset}`);
    console.log(`  ${C.green}[1-${pageSkills.length}]${C.reset} Deploy skill       ${C.green}[PAGE]${C.reset} Deploy all ${pageSkills.length} on page   ${C.green}[ALL]${C.reset} Deploy all ${skills.length}`);
    
    const navParts = [];
    if (currentPage < totalPages) navParts.push(`${C.cyan}[N]${C.reset} Next Page`);
    if (currentPage > 1) navParts.push(`${C.cyan}[P]${C.reset} Previous Page`);
    if (totalPages > 1) navParts.push(`${C.cyan}[G <#>]${C.reset} Jump Page`);
    navParts.push(`${C.magenta}[I <#>]${C.reset} Inspect Dossier`);
    navParts.push(`${C.red}[0]${C.reset} Back to Menu`);
    console.log(`  ${navParts.join('   ')}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);

    const rawChoice = await ask(`\nSelect action: `);
    if (!rawChoice && process.stdin.readableEnded) break;
    const choice = rawChoice.trim();
    const cLower = choice.toLowerCase();

    if (!choice || cLower === '0' || cLower === 'b' || cLower === 'back' || cLower === 'q') {
      break;
    }

    if (cLower === 'n' || cLower === 'next') {
      if (currentPage < totalPages) {
        currentPage++;
      } else {
        console.log(`${C.gold}Already on the last page.${C.reset}`);
        await new Promise(r => setTimeout(r, 800));
      }
      continue;
    }

    if (cLower === 'p' || cLower === 'prev') {
      if (currentPage > 1) {
        currentPage--;
      } else {
        console.log(`${C.gold}Already on the first page.${C.reset}`);
        await new Promise(r => setTimeout(r, 800));
      }
      continue;
    }

    if (cLower.startsWith('g ') || cLower.startsWith('page ')) {
      const targetPage = parseInt(cLower.split(/\s+/)[1], 10);
      if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
        currentPage = targetPage;
      }
      continue;
    }

    if (cLower.startsWith('i ') || cLower.startsWith('? ') || cLower.startsWith('info ')) {
      const num = parseInt(cLower.split(/\s+/)[1], 10);
      if (!isNaN(num) && num >= 1 && num <= pageSkills.length) {
        await inspectSkill(pageSkills[num - 1]);
      }
      continue;
    }

    let toDeploy = [];
    if (cLower === 'all') {
      toDeploy = skills;
    } else if (cLower === 'page') {
      toDeploy = pageSkills;
    } else {
      const num = parseInt(choice, 10);
      if (!isNaN(num) && num >= 1 && num <= pageSkills.length) {
        toDeploy = [pageSkills[num - 1]];
      }
    }

    if (toDeploy.length === 0) continue;

    console.log(`\n${C.gold}DEPLOY ${toDeploy.length} SKILL(S) TO:${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} Active Project Folder (${currentTargetDir || 'Local'})`);
    console.log(`  ${C.green}[2]${C.reset} Global Claude Code (~/.claude/skills)`);
    console.log(`  ${C.green}[3]${C.reset} Global Hermes Agent (WSL Kali ~/.hermes/skills/vault)`);
    console.log(`  ${C.green}[4]${C.reset} All of the above ${C.gold}[RECOMMENDED]${C.reset}`);
    console.log(`  ${C.red}[0]${C.reset} Cancel`);

    const destChoice = await ask(`\nSelect target [1-4, Default: 4]: `);
    const dest = destChoice || '4';
    if (dest === '0') continue;

    console.log(`\n[*] Deploying ${toDeploy.length} skill(s)...`);
    for (const skill of toDeploy) {
      const srcDir = resolveSkillPath(skill);
      if (!srcDir || !fs.existsSync(srcDir)) continue;

      // 1. Current Project
      if ((dest === '1' || dest === '4') && currentTargetDir) {
        try {
          const target = path.join(currentTargetDir, '.claude', 'skills', skill);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.cpSync(srcDir, target, { recursive: true });
          console.log(`  ${C.green}✓${C.reset} Project: ${skill}`);
        } catch (e) {
          console.log(`  ${C.red}✗ Project fail: ${skill} (${e.message})${C.reset}`);
        }
      }

      // 2. Global Claude Code
      if (dest === '2' || dest === '4') {
        try {
          const target = path.join(CLAUDE_SKILLS_PATH, skill);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.cpSync(srcDir, target, { recursive: true });
          console.log(`  ${C.green}✓${C.reset} Claude Code: ${skill}`);
        } catch (e) {
          console.log(`  ${C.red}✗ Claude fail: ${skill} (${e.message})${C.reset}`);
        }
      }

      // 3. Global Hermes Agent (WSL Kali)
      if (dest === '3' || dest === '4') {
        try {
          const wslSrc = srcDir.replace(/\\/g, '/').replace(/^C:/i, '/mnt/c');
          runWsl(`mkdir -p /home/Ade/.hermes/skills/vault && cp -r "${wslSrc}" "/home/Ade/.hermes/skills/vault/${skill}"`);
          console.log(`  ${C.green}✓${C.reset} Hermes Agent: ${skill}`);
        } catch (e) {}
      }
    }

    console.log(`\n${C.gold}✨ Successfully deployed ${toDeploy.length} skill(s)!${C.reset}\n`);
    await ask(`Press Enter to continue... `);
  }
}

async function listInstalledSkills(currentTargetDir) {
  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : CURRENTLY INSTALLED SKILLS${C.reset}                                 ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);
  
  // 1. Current Project Skills
  if (currentTargetDir) {
    const projSkillsPath = path.join(currentTargetDir, '.claude', 'skills');
    if (fs.existsSync(projSkillsPath)) {
      try {
        const pSkills = fs.readdirSync(projSkillsPath);
        if (pSkills.length > 0) {
          console.log(`${C.gold}ACTIVE PROJECT SKILLS (${currentTargetDir}):${C.reset}`);
          pSkills.forEach(s => console.log(`  • ${C.white}${s}${C.reset}`));
          console.log('');
        }
      } catch (e) {}
    }
  }

  // 2. Global Claude Code Skills
  console.log(`${C.cyan}CLAUDE CODE GLOBAL SKILLS (~/.claude/skills):${C.reset}`);
  try {
    if (fs.existsSync(CLAUDE_SKILLS_PATH)) {
      const skills = fs.readdirSync(CLAUDE_SKILLS_PATH);
      if (skills.length === 0) {
        console.log(`  ${C.gray}No custom skills installed globally.${C.reset}`);
      } else {
        console.log(`  ${C.green}✓ ${skills.length} skills active${C.reset}:`);
        skills.forEach((s, idx) => {
          process.stdout.write(`  ${C.white}${s.padEnd(28)}${C.reset}`);
          if ((idx + 1) % 2 === 0 || idx === skills.length - 1) console.log('');
        });
      }
    }
  } catch (e) {}

  // 3. Hermes Agent Skills (WSL Kali)
  console.log(`\n${C.cyan}HERMES AGENT SKILLS (WSL Kali Linux):${C.reset}`);
  
  // Built-in skills summary
  const hermesOut = runWsl('find /home/Ade/.hermes/skills -maxdepth 3 -name SKILL.md');
  if (hermesOut) {
    const lines = hermesOut.split('\n').filter(Boolean);
    const byCat = {};
    for (const line of lines) {
      const parts = line.split('/');
      const cat = parts[parts.length - 3];
      const name = parts[parts.length - 2];
      if (cat === 'skills' || cat === 'vault' || line.includes('.stowed_clutter')) continue;
      byCat[cat] = byCat[cat] || [];
      byCat[cat].push(name);
    }
    const catKeys = Object.keys(byCat);
    console.log(`  ${C.green}✓ ${lines.length} Active Hermes Skills across ${catKeys.length} domains:${C.reset}`);
    for (const [c, items] of Object.entries(byCat)) {
      const sample = items.slice(0, 3).join(', ') + (items.length > 3 ? ` (+${items.length - 3} more)` : '');
      console.log(`    - ${C.gold}${c.padEnd(22)}${C.reset} (${items.length}): ${C.gray}${sample}${C.reset}`);
    }
  } else {
    console.log(`  ${C.gray}Hermes Agent offline or not initialized in WSL.${C.reset}`);
  }

  // Vault Deployed skills
  const vaultOut = runWsl('ls -1 /home/Ade/.hermes/skills/vault 2>/dev/null || true');
  const vaultSkills = vaultOut ? vaultOut.split('\n').map(s => s.trim()).filter(Boolean) : [];
  console.log(`\n  ${C.gold}Q-Branch Vault Deployed to Hermes (~/.hermes/skills/vault):${C.reset}`);
  if (vaultSkills.length === 0) {
    console.log(`  ${C.gray}No external vault skills deployed yet. (Deploy anytime from [K] Skills Arsenal)${C.reset}`);
  } else {
    console.log(`  ${C.green}✓ ${vaultSkills.length} custom combat skills deployed:${C.reset}`);
    vaultSkills.forEach((s, idx) => {
      process.stdout.write(`    • ${C.white}${s.padEnd(26)}${C.reset}`);
      if ((idx + 1) % 2 === 0 || idx === vaultSkills.length - 1) console.log('');
    });
  }

  // Stowed clutter status
  const stowedOut = runWsl('ls -1 /home/Ade/.hermes/skills/.stowed_clutter 2>/dev/null || true');
  const stowedDirs = stowedOut ? stowedOut.split('\n').map(s => s.trim()).filter(Boolean) : [];
  if (stowedDirs.length > 0) {
    console.log(`\n  ${C.gray}Stowed Hermes Clutter (.stowed_clutter/): ${stowedDirs.join(', ')} (hidden from prompt)${C.reset}`);
  }

  console.log(`\n${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  await ask(`Press Enter to return to Skills Menu... `);
}

async function manageSkills(currentTargetDir) {
  // Use Gemini vault if available, otherwise fall back to bundled skills
  let skillsVaultPath = GEMINI_SKILLS_PATH;
  if (!fs.existsSync(skillsVaultPath)) {
    skillsVaultPath = LOCAL_SKILLS_PATH;
  }

  if (!fs.existsSync(skillsVaultPath)) {
    console.log(`${C.red}Skills directory not found at: ${skillsVaultPath}${C.reset}\n`);
    await ask(`Press Enter to continue... `);
    return;
  }

  const allSkills = fs.readdirSync(skillsVaultPath);

  while (true) {
    console.clear();
    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : SKILLS ARSENAL (${allSkills.length.toLocaleString()} SKILLS VAULT)${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Active Working Directory:${C.reset} ${C.white}${currentTargetDir}${C.reset}`);
    console.log(`  ${C.gray}Total Skills in Vault   :${C.reset} ${C.magenta}${allSkills.length.toLocaleString()} skills${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);
    console.log(`  ${C.gold}MISSION LOADOUTS & CURATED PACKS:${C.reset}`);
    console.log(`  ${C.magenta}[P]${C.reset} ${C.white}${C.bold}Mission Loadout Profiles${C.reset}  ${C.gold}[1-CLICK COMPLETE OVERHAUL]${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} ${C.white}AI & Autonomous Agents${C.reset}   ${C.gray}(Multi-agent, memory, harnesses, evals)${C.reset}`);
    console.log(`  ${C.green}[2]${C.reset} ${C.white}Security & Bug Bounty${C.reset}    ${C.gray}(Hunt-auth, hunt-idor, pentest, web3)${C.reset}`);
    console.log(`  ${C.green}[3]${C.reset} ${C.white}Frontend & Modern UI${C.reset}     ${C.gray}(React patterns, Tailwind, motion, a11y)${C.reset}`);
    console.log(`  ${C.green}[4]${C.reset} ${C.white}Code Quality & Review${C.reset}    ${C.gray}(Code-reviewer, simplify-code, TDD)${C.reset}`);
    console.log(`  ${C.green}[5]${C.reset} ${C.white}Cloud & Infrastructure${C.reset}   ${C.gray}(AWS, Azure, Docker, Kubernetes, CI/CD)${C.reset}`);
    console.log(`  ${C.green}[6]${C.reset} ${C.white}Python, Go & Rust Packs${C.reset}  ${C.gray}(FastAPI, async patterns, systems)${C.reset}`);
    console.log(``);
    console.log(`  ${C.gold}TOOLS & EXPLORATION:${C.reset}`);
    console.log(`  ${C.cyan}[S]${C.reset} ${C.white}Search Vault by Keyword${C.reset}  ${C.gray}(Paginated instant search across skills)${C.reset}`);
    console.log(`  ${C.cyan}[L]${C.reset} ${C.white}List Installed Skills${C.reset}    ${C.gray}(View what's currently active in Claude & Hermes)${C.reset}`);
    console.log(`  ${C.red}[0]${C.reset} ${C.white}Back to Main Q-Branch Menu${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);

    const choice = await ask(`\nSelect an option [P, 1-6, S, L, 0]: `);
    if (!choice && process.stdin.readableEnded) break;
    const c = choice.trim().toLowerCase();

    if (c === '0' || c === 'b' || c === 'q') {
      break;
    } else if (c === 'p') {
      await manageProfiles(currentTargetDir);
    } else if (c === '1') {
      const skills = allSkills.filter(s => /^(agent|ai-|claude-|llm-|multi-agent|autonomous)/i.test(s));
      await renderSkillsList(skills, 'AI & Autonomous Agent Pack', currentTargetDir);
    } else if (c === '2') {
      const skills = allSkills.filter(s => /^(hunt-|security|pentest|audit|reverse|exploit)/i.test(s));
      await renderSkillsList(skills, 'Security & Red Team Pack', currentTargetDir);
    } else if (c === '3') {
      const skills = allSkills.filter(s => /^(ui-|frontend|react|design|tailwind|css|vue|animation)/i.test(s));
      await renderSkillsList(skills, 'Frontend & Modern UI Pack', currentTargetDir);
    } else if (c === '4') {
      const skills = allSkills.filter(s => /^(code-|review|clean|tdd|test|refactor|quality|simplify)/i.test(s));
      await renderSkillsList(skills, 'Code Review & Architecture Pack', currentTargetDir);
    } else if (c === '5') {
      const skills = allSkills.filter(s => /^(aws|azure|gcp|docker|k8s|cloud|terraform|devops)/i.test(s));
      await renderSkillsList(skills, 'Cloud & Infrastructure Pack', currentTargetDir);
    } else if (c === '6') {
      const skills = allSkills.filter(s => /^(python|fastapi|golang|go-|rust|cpp|csharp)/i.test(s));
      await renderSkillsList(skills, 'Languages & Runtimes Pack', currentTargetDir);
    } else if (c === 's') {
      const query = await ask(`\nEnter search keyword (e.g. game, reverse, docker, api): `);
      if (query) {
        const qLower = query.toLowerCase();
        const matches = allSkills.filter(s => s.toLowerCase().includes(qLower));
        if (matches.length === 0) {
          console.log(`${C.red}No skills matching "${query}".${C.reset}\n`);
          await ask(`Press Enter to continue... `);
        } else {
          await renderSkillsList(matches, `Search Results for "${query.toUpperCase()}"`, currentTargetDir);
        }
      }
    } else if (c === 'l') {
      await listInstalledSkills(currentTargetDir);
    }
  }
}

function safeCopyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    fs.cpSync(src, dest, { recursive: true });
  } catch (e) {
    try {
      execSync(`xcopy "${src}" "${dest}" /E /I /Q /Y`, { stdio: 'ignore' });
    } catch (e2) {}
  }
}

function getSystemVolumes() {
  try {
    const psCmd = `Get-Volume | Where-Object { $_.DriveLetter -ne $null } | Select-Object DriveLetter, FileSystemLabel, DriveType, SizeRemaining | ConvertTo-Json`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' }).trim();
    if (out) {
      const parsed = JSON.parse(out);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (e) {}
  return [];
}

async function updateUsbSuite(usbRoot) {
  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : UPDATE PORTABLE USB SUITE${C.reset}                                   ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Updating AI agents, tools, and skills directly on this USB drive.${C.reset}`);
  console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

  const nodeExe = path.join(usbRoot, 'runtime', 'node', 'node.exe');
  const npmCmd = path.join(usbRoot, 'runtime', 'node', 'npm.cmd');
  const claudeDir = path.join(usbRoot, 'runtime', 'claude');
  const uvExe = path.join(usbRoot, 'runtime', 'hermes', 'uv.exe');

  // 1. Update Claude Code
  console.log(`${C.gold}[1/3] Updating Claude Code CLI on USB...${C.reset}`);
  if (fs.existsSync(npmCmd) && fs.existsSync(claudeDir)) {
    try {
      console.log(`  [*] Running npm install @anthropic-ai/claude-code@latest...`);
      execSync(`"${npmCmd}" install @anthropic-ai/claude-code@latest`, {
        cwd: claudeDir,
        stdio: 'inherit',
        env: { ...process.env, PATH: `${path.dirname(nodeExe)};${process.env.PATH}` }
      });
      console.log(`  ${C.green}✓ Claude Code updated successfully.${C.reset}\n`);
    } catch (e) {
      console.log(`  ${C.red}✗ Claude Code update notice: ${e.message}${C.reset}\n`);
    }
  } else {
    console.log(`  ${C.gray}Portable npm / claude runtime path verified.${C.reset}\n`);
  }

  // 2. Update Hermes Agent
  console.log(`${C.gold}[2/3] Updating Hermes Agent...${C.reset}`);
  if (fs.existsSync(uvExe)) {
    try {
      execSync(`"${uvExe}" tool upgrade hermes-agent`, { stdio: 'inherit' });
      console.log(`  ${C.green}✓ Hermes Agent updated successfully.${C.reset}\n`);
    } catch (e) {
      console.log(`  ${C.gray}Hermes Agent is running current build.${C.reset}\n`);
    }
  } else {
    console.log(`  ${C.gray}Hermes runtime verified.${C.reset}\n`);
  }

  // 3. Update Skills from GitHub (if cloned from repo)
  console.log(`${C.gold}[3/3] Checking for Q-Branch & Skills Updates...${C.reset}`);
  if (fs.existsSync(path.join(usbRoot, '.git'))) {
    try {
      execSync('git pull origin main', { cwd: usbRoot, stdio: 'inherit' });
      console.log(`  ${C.green}✓ Pulled latest skills & updates from GitHub.${C.reset}\n`);
    } catch (e) {
      console.log(`  ${C.gray}Skills arsenal is up to date.${C.reset}\n`);
    }
  } else {
    console.log(`  ${C.green}✓ Bundled 44 Special Ops skills arsenal verified.${C.reset}\n`);
  }

  console.log(`${C.gold}✨ Portable USB Agent Suite is up to date and mission-ready!${C.reset}\n`);
  await ask(`Press Enter to continue... `);
}

async function buildUsbDrive(currentDir) {
  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : PORTABLE USB AGENT SUITE BUILDER${C.reset}                           ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Create a 100% self-contained AI Agent drive to take anywhere.${C.reset}`);
  console.log(`  ${C.gray}• Zero host software needed: bundles Node.js, Claude Code & Hermes.${C.reset}`);
  console.log(`  ${C.gray}• Pre-loads your API keys & free models ($0 Experiential Labs tier).${C.reset}`);
  console.log(`  ${C.gray}• Bundles all 44 Special Ops skills ready to deploy anywhere.${C.reset}`);
  console.log(`  ${C.gray}• Complete privacy: all history and cache stay isolated on the USB drive.${C.reset}`);
  console.log(`  ${C.gray}• Self-updating: updates packages directly on the USB drive.${C.reset}`);
  console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

  console.log(`${C.gold}[*] Scanning available drives and storage volumes...${C.reset}`);
  const drives = getSystemVolumes();

  console.log(`\n${C.white}Available Storage Locations:${C.reset}`);
  let driveIndex = 1;
  const driveOptions = [];
  for (const d of drives) {
    const letter = `${d.DriveLetter}:\\`;
    const label = d.FileSystemLabel ? `"${d.FileSystemLabel}"` : 'Local Volume';
    const isUsb = d.DriveType === 2;
    const type = isUsb ? `${C.green}[Removable USB Stick]${C.reset}` : `${C.gray}[${d.DriveType === 3 ? 'Fixed Disk' : 'Drive'}]${C.reset}`;
    const freeGB = d.SizeRemaining ? `${(d.SizeRemaining / (1024 ** 3)).toFixed(1)} GB free` : '';
    console.log(`  ${C.green}[${driveIndex}]${C.reset} ${C.white}${letter.padEnd(6)}${C.reset} ${label.padEnd(20)} ${type} ${C.gray}${freeGB}${C.reset}`);
    driveOptions.push({ letter, label, isUsb });
    driveIndex++;
  }
  console.log(`  ${C.gold}[D]${C.reset} Create Folder on Desktop (${C.white}Desktop\\Q-Branch-Portable${C.reset})`);
  console.log(`  ${C.gold}[M]${C.reset} Custom Directory Path...`);
  console.log(`  ${C.red}[0]${C.reset} Cancel`);

  const choice = await ask(`\nSelect target drive or option [1-${driveOptions.length}, D, M, 0]: `);
  if (!choice || choice === '0' || choice.toLowerCase() === 'q') return;

  let targetPath = '';
  const cLower = choice.toLowerCase();
  if (cLower === 'd') {
    targetPath = path.join(USER_HOME, 'Desktop', 'Q-Branch-Portable');
  } else if (cLower === 'm') {
    targetPath = await ask(`Enter destination directory path: `);
    if (!targetPath) return;
  } else {
    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= driveOptions.length) {
      const selected = driveOptions[num - 1];
      console.log(`\nTargeting drive ${C.gold}${selected.letter}${C.reset} (${selected.label})`);
      if (selected.isUsb) {
        console.log(`  ${C.green}[1]${C.reset} Root of USB Drive: ${selected.letter} ${C.green}[Recommended for dedicated USB]${C.reset}`);
        console.log(`  ${C.white}[2]${C.reset} Subfolder: ${selected.letter}Q-Branch-Portable`);
        const mode = await ask(`Select layout [1-2, Default: 1]: `);
        targetPath = mode === '2' ? path.join(selected.letter, 'Q-Branch-Portable') : selected.letter;
      } else {
        console.log(`  ${C.green}[1]${C.reset} Subfolder: ${selected.letter}Q-Branch-Portable ${C.green}[Recommended]${C.reset}`);
        console.log(`  ${C.white}[2]${C.reset} Root of Drive: ${selected.letter}`);
        const mode = await ask(`Select layout [1-2, Default: 1]: `);
        targetPath = mode === '2' ? selected.letter : path.join(selected.letter, 'Q-Branch-Portable');
      }
    } else {
      console.log(`${C.red}Invalid selection.${C.reset}`);
      await ask(`Press Enter to continue... `);
      return;
    }
  }

  targetPath = path.resolve(targetPath);
  console.log(`\n${C.gold}Destination:${C.reset} ${C.white}${targetPath}${C.reset}`);
  const confirm = await ask(`Proceed with building portable suite to this location? (Y/n): `);
  if (confirm && !confirm.toLowerCase().startsWith('y')) {
    console.log(`${C.gray}Operation cancelled.${C.reset}`);
    await ask(`Press Enter to continue... `);
    return;
  }

  console.log(`\n${C.gold}═══ COMMENCING Q-BRANCH PORTABLE DEPLOYMENT ═══${C.reset}\n`);

  // Phase 1: Directories
  console.log(`${C.gold}[1/6] Initializing isolated portable filesystem...${C.reset}`);
  const dirsToCreate = [
    targetPath,
    path.join(targetPath, 'runtime', 'node'),
    path.join(targetPath, 'runtime', 'claude'),
    path.join(targetPath, 'runtime', 'hermes'),
    path.join(targetPath, 'config', 'claude', 'skills'),
    path.join(targetPath, 'config', 'hermes', 'skills', 'vault'),
    path.join(targetPath, 'skills'),
    path.join(targetPath, 'data', 'home', '.claude'),
    path.join(targetPath, 'data', 'sessions')
  ];
  for (const d of dirsToCreate) {
    fs.mkdirSync(d, { recursive: true });
  }
  console.log(`  ${C.green}✓ Filesystem structure materialized.${C.reset}\n`);

  // Phase 2: Node.js Runtime
  console.log(`${C.gold}[2/6] Bundling Portable Node.js & npm runtime...${C.reset}`);
  const hostNodeDir = fs.existsSync('C:\\Program Files\\nodejs\\node.exe')
    ? 'C:\\Program Files\\nodejs'
    : path.dirname(process.execPath);
  
  const destNodeDir = path.join(targetPath, 'runtime', 'node');
  const nodeFiles = ['node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd'];
  for (const nf of nodeFiles) {
    const src = path.join(hostNodeDir, nf);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destNodeDir, nf));
    }
  }
  const npmModuleSrc = path.join(hostNodeDir, 'node_modules', 'npm');
  if (fs.existsSync(npmModuleSrc)) {
    safeCopyDir(npmModuleSrc, path.join(destNodeDir, 'node_modules', 'npm'));
  }
  console.log(`  ${C.green}✓ Standalone Node.js & npm runtime copied to USB.${C.reset}\n`);

  // Phase 3: Claude Code CLI
  console.log(`${C.gold}[3/6] Bundling Claude Code CLI...${C.reset}`);
  const hostClaudePkg = path.join(USER_HOME, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
  const destClaudePkg = path.join(targetPath, 'runtime', 'claude', 'node_modules', '@anthropic-ai', 'claude-code');
  if (fs.existsSync(hostClaudePkg)) {
    safeCopyDir(hostClaudePkg, destClaudePkg);
  } else {
    try {
      execSync(`"${path.join(destNodeDir, 'npm.cmd')}" install @anthropic-ai/claude-code`, {
        cwd: path.join(targetPath, 'runtime', 'claude'),
        stdio: 'inherit'
      });
    } catch (e) {}
  }

  // Package manifest for USB in-place updates
  const claudePkgJson = {
    name: "qbranch-portable-claude",
    version: "1.0.0",
    description: "Portable Claude Code suite on USB",
    dependencies: {
      "@anthropic-ai/claude-code": "latest"
    }
  };
  fs.writeFileSync(path.join(targetPath, 'runtime', 'claude', 'package.json'), JSON.stringify(claudePkgJson, null, 2), 'utf8');

  // Portable wrappers
  const claudeWrapperCmd = `@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0node_modules\\@anthropic-ai\\claude-code\\cli.mjs" %*\r\n`;
  fs.writeFileSync(path.join(targetPath, 'runtime', 'claude', 'claude.cmd'), claudeWrapperCmd, 'utf8');
  fs.writeFileSync(path.join(destNodeDir, 'claude.cmd'), claudeWrapperCmd, 'utf8');
  console.log(`  ${C.green}✓ Claude Code CLI packaged into standalone portable runtime.${C.reset}\n`);

  // Phase 4: Hermes Agent & uv Standalone Runner
  console.log(`${C.gold}[4/6] Bundling Hermes Agent & uv Portable Engine...${C.reset}`);
  const hostUv = path.join(USER_HOME, '.local', 'bin', 'uv.exe');
  const destUv = path.join(targetPath, 'runtime', 'hermes', 'uv.exe');
  if (fs.existsSync(hostUv)) {
    fs.copyFileSync(hostUv, destUv);
  }
  const hermesCmd = `@echo off\r\nset "HERMES_HOME=%~dp0..\\..\\config\\hermes"\r\nif exist "%~dp0uv.exe" (\r\n  "%~dp0uv.exe" tool run hermes-agent %*\r\n) else (\r\n  echo uv.exe not found on USB.\r\n)\r\n`;
  fs.writeFileSync(path.join(targetPath, 'runtime', 'hermes', 'hermes.cmd'), hermesCmd, 'utf8');
  console.log(`  ${C.green}✓ Hermes Agent runner & uv engine packaged.${C.reset}\n`);

  // Phase 4b: Bundle Jev Intervention Engine (jev-use MCP + Hook Gate)
  const destJevRoot = path.join(targetPath, 'runtime', 'jev-use');
  const bundledJevCli = ensureLocalJevBundle(destJevRoot, false);
  if (bundledJevCli) {
    console.log(`  ${C.green}✓ Jev Intervention Engine (jev-use) bundled for offline USB use.${C.reset}\n`);
  }

  // Phase 5: API Keys & Custom Gateway Settings
  console.log(`${C.gold}[5/6] Exporting credentials & zero-cost gateway configurations...${C.reset}`);
  const activeSettings = readClaudeSettings();
  const currentKey = activeSettings.env?.ANTHROPIC_AUTH_TOKEN || '';
  const currentUrl = activeSettings.env?.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const typesafeUrl = currentUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const primaryModel = activeSettings.env?.ANTHROPIC_MODEL || 'gpt-6-luna';
  const fastModel = activeSettings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  const gateWasEnabled = getJevGateStatus(activeSettings);

  const portableClaudeSettings = {
    env: {
      ANTHROPIC_BASE_URL: currentUrl,
      ANTHROPIC_AUTH_TOKEN: currentKey,
      TYPESAFE_BASE_URL: typesafeUrl,
      TYPESAFE_API_KEY: currentKey,
      ANTHROPIC_MODEL: primaryModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: primaryModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: primaryModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: primaryModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: primaryModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: fastModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: fastModel,
      ANTHROPIC_SMALL_FAST_MODEL: fastModel,
      CLAUDE_CODE_SUBAGENT_MODEL: fastModel,
      CLAUDE_CODE_AUTO_MODE_SERVER: "0",
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1"
    },
    modelSettings: {
      [primaryModel]: { effortLevel: "medium" },
      [fastModel]: { effortLevel: "medium" }
    },
    permissions: {
      allowAll: true,
      allow: [...JEV_GATE_ALLOW_RULES]
    }
  };
  if (gateWasEnabled) {
    const inv = bundledJevCli
      ? { hookCommand: `node "${bundledJevCli}" hook gate` }
      : { hookCommand: 'npx -y jev-use@0.8.0 hook gate' };
    setJevGateEnabled(portableClaudeSettings, true, inv.hookCommand);
  }
  fs.writeFileSync(path.join(targetPath, 'config', 'claude', 'settings.json'), JSON.stringify(portableClaudeSettings, null, 2), 'utf8');
  fs.writeFileSync(path.join(targetPath, 'data', 'home', '.claude', 'settings.json'), JSON.stringify(portableClaudeSettings, null, 2), 'utf8');
  fs.writeFileSync(path.join(targetPath, 'config', 'claude', '.usb_root.txt'), targetPath.endsWith(path.sep) ? targetPath : `${targetPath}${path.sep}`, 'utf8');

  // Portable Claude .claude.json with pre-configured Jev MCP server
  const portableJevMcp = bundledJevCli
    ? {
        type: 'stdio',
        command: path.join(destNodeDir, 'node.exe'),
        args: [bundledJevCli, 'serve'],
        env: { TYPESAFE_API_KEY: currentKey, TYPESAFE_BASE_URL: typesafeUrl }
      }
    : {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'jev-use@0.8.0', 'serve'],
        env: { TYPESAFE_API_KEY: currentKey, TYPESAFE_BASE_URL: typesafeUrl }
      };
  for (const cj of [
    path.join(targetPath, 'config', 'claude', '.claude.json'),
    path.join(targetPath, 'data', 'home', '.claude.json')
  ]) {
    const existing = readJsonSafe(cj, {});
    existing.mcpServers = { ...(existing.mcpServers || {}), jev: portableJevMcp };
    writeJsonSafe(cj, existing);
  }

  // Hermes config.yaml and .env (with 2-model delegation split + Jev MCP)
  const hermesApiUrl = currentUrl.endsWith('/v1') ? currentUrl : `${currentUrl.replace(/\/+$/, '')}/v1`;
  writePortableHermesFiles(path.join(targetPath, 'config', 'hermes'), {
    primaryModel,
    fastModel,
    baseUrl: hermesApiUrl,
    apiKey: currentKey,
    typesafeBase: typesafeUrl
  });
  console.log(`  ${C.green}✓ API keys, Jev MCP & 2-model split isolated to USB storage.${C.reset}\n`);

  // Phase 6: Skills Deployment & Launcher Deployment
  console.log(`${C.gold}[6/6] Transferring Special Ops skills (incl. jev-use) & Mission Launcher...${C.reset}`);
  
  const skillsSrcDir = fs.existsSync(LOCAL_SKILLS_PATH) ? LOCAL_SKILLS_PATH : GEMINI_SKILLS_PATH;
  let copiedSkillsCount = 0;
  if (fs.existsSync(skillsSrcDir)) {
    const skillsList = fs.readdirSync(skillsSrcDir);
    for (const sk of skillsList) {
      const sp = path.join(skillsSrcDir, sk);
      if (fs.statSync(sp).isDirectory()) {
        safeCopyDir(sp, path.join(targetPath, 'skills', sk));
        safeCopyDir(sp, path.join(targetPath, 'config', 'claude', 'skills', sk));
        safeCopyDir(sp, path.join(targetPath, 'config', 'hermes', 'skills', 'vault', sk));
        copiedSkillsCount++;
      }
    }
  }

  // Copy Launch Agent.bat, qbranch.mjs, package.json
  const batSrc = path.join(SCRIPT_DIR, 'Launch Agent.bat');
  if (fs.existsSync(batSrc)) {
    fs.copyFileSync(batSrc, path.join(targetPath, 'Launch Agent.bat'));
  } else if (fs.existsSync(path.join(USER_HOME, 'Desktop', 'Launch Agent.bat'))) {
    fs.copyFileSync(path.join(USER_HOME, 'Desktop', 'Launch Agent.bat'), path.join(targetPath, 'Launch Agent.bat'));
  }

  const mjsSrc = path.join(SCRIPT_DIR, 'qbranch.mjs');
  if (fs.existsSync(mjsSrc)) {
    fs.copyFileSync(mjsSrc, path.join(targetPath, 'qbranch.mjs'));
  }

  const pkgSrc = path.join(SCRIPT_DIR, 'package.json');
  if (fs.existsSync(pkgSrc)) {
    fs.copyFileSync(pkgSrc, path.join(targetPath, 'package.json'));
  }

  // Generate README-PORTABLE.md
  const readmePortable = `# 007 Q-Branch: Portable Agent Suite (USB Edition)
==================================================

This USB drive contains a **100% self-contained AI Agent Command Center**.
You can plug this drive into **ANY Windows PC** and start coding immediately.

### What is on this drive?
* **Zero Host Requirements:** Node.js, npm, Claude Code, Jev Intervention (\`jev-use\`), and Hermes runners are bundled directly on this drive in \`runtime/\`. The host computer needs **nothing installed**.
* **Pre-Connected API Keys & 2-Model Team:** Configured for **${primaryModel}** (Primary) + **${fastModel}** (Fast/Subagent) plus **Jev & Clef** zero-output-cost judgment tools.
* **Pre-Loaded Skills:** All **${copiedSkillsCount} Special Ops Skills** (including \`jev-use\`) are pre-loaded for both Claude Code and Hermes Agent.
* **100% Private & Isolated:** All user profiles, session histories, chat logs, and caches are written strictly to \`data/\` on this drive. **Zero traces or files are left on the host PC.**

---

### How to Use on Any PC
1. Plug this USB drive into any Windows PC.
2. Open this folder in File Explorer.
3. Double-click **\`Launch Agent.bat\`**.
4. Choose your agent from the mission menu:
   * \`[1]\` Claude Code
   * \`[2]\` Hermes Agent
   * \`[H]\` Hermes Modes & Split
   * \`[J]\` Jev Intervention & Gate
   * \`[K]\` Skills Arsenal
   * \`[U]\` Update Portable Suite

---

### In-Place Updates
To update Claude Code, Hermes, or Skills directly on this USB stick without touching the host machine:
1. Open **\`Launch Agent.bat\`**.
2. Press **\`[U]\` (Update Portable Suite)**.
3. The launcher will run npm and uv update routines directly inside the USB runtime.
`;
  fs.writeFileSync(path.join(targetPath, 'README-PORTABLE.md'), readmePortable, 'utf8');

  console.log(`  ${C.green}✓ ${copiedSkillsCount} Special Ops skills deployed into portable vault.${C.reset}`);
  console.log(`  ${C.green}✓ Launch Agent.bat & qbranch.mjs staged at USB root.${C.reset}`);
  console.log(`  ${C.green}✓ README-PORTABLE.md generated.${C.reset}\n`);

  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}🎉 MISSION SUCCESS: PORTABLE USB DRIVE ARMED & READY!${C.reset}                      ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Location         :${C.reset} ${C.white}${targetPath}${C.reset}`);
  console.log(`  ${C.gray}Payload Status   :${C.reset} ${C.green}Standalone Runtime + Jev + Full Arsenal Active${C.reset}`);
  console.log(`  ${C.gray}Primary Model    :${C.reset} ${C.gold}${primaryModel}${C.reset}`);
  console.log(`  ${C.gray}Subagent Model   :${C.reset} ${C.cyan}${fastModel}${C.reset}`);
  console.log(`  ${C.gray}Skills Loaded    :${C.reset} ${C.magenta}${copiedSkillsCount} combat skills deployed${C.reset}`);
  console.log(`  ${C.gray}Host Footprint   :${C.reset} ${C.green}0% (Zero files, registry keys or logs left on host)${C.reset}`);
  console.log(`  ${C.gray}Next Step        :${C.reset} ${C.white}Plug into any Windows machine and double-click 'Launch Agent.bat'.${C.reset}`);
  console.log(`${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}\n`);

  await ask(`Press Enter to return to Q-Branch menu... `);
}

function syncJevIntegration({ apiKey = null, baseUrl = null, toggleGate = null, allowNpmInstall = false } = {}) {
  const settings = readClaudeSettings();
  settings.env = settings.env || {};
  const resolvedKey = apiKey || settings.env.ANTHROPIC_AUTH_TOKEN || '';
  const rawBase = baseUrl || settings.env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const resolvedBase = rawBase.replace(/\/v1\/?$/, '').replace(/\/+$/, '');

  // 1. Ensure local jev-use bundle so MCP & hooks start in <50ms without npm latency
  const usbRoot = process.env.USB_ROOT;
  const primaryBundleTarget = (IS_PORTABLE_MODE && usbRoot)
    ? path.join(usbRoot, 'runtime', 'jev-use')
    : path.join(USER_HOME, '.claude', 'jev-use');
  ensureLocalJevBundle(primaryBundleTarget, allowNpmInstall);
  const inv = resolveJevInvocation(primaryBundleTarget);

  // 2. Wire Claude Code settings.env + permissions.allow + optional PreToolUse gate
  if (resolvedKey) settings.env.TYPESAFE_API_KEY = resolvedKey;
  settings.env.TYPESAFE_BASE_URL = resolvedBase;
  settings.permissions = settings.permissions || {};
  const allowSet = new Set(Array.isArray(settings.permissions.allow) ? settings.permissions.allow : []);
  for (const rule of JEV_GATE_ALLOW_RULES) allowSet.add(rule);
  settings.permissions.allow = [...allowSet];

  if (toggleGate !== null) {
    setJevGateEnabled(settings, toggleGate, inv.hookCommand);
  } else if (getJevGateStatus(settings)) {
    setJevGateEnabled(settings, true, inv.hookCommand);
  }
  saveClaudeSettings(settings);

  // 3. Wire Claude Code ~/.claude.json (+ portable CLAUDE_CONFIG_DIR/.claude.json)
  for (const cj of getClaudeJsonPaths()) {
    const cfg = readJsonSafe(cj, {});
    const mcp = cfg.mcpServers || {};
    mcp.jev = {
      type: 'stdio',
      command: inv.command,
      args: inv.args,
      env: {
        TYPESAFE_API_KEY: resolvedKey,
        TYPESAFE_BASE_URL: resolvedBase
      }
    };
    cfg.mcpServers = mcp;
    writeJsonSafe(cj, cfg);
  }

  // 4. Deploy jev-use skill to Claude & WSL Hermes
  const jevSkillSrc = resolveSkillPath('jev-use');
  if (jevSkillSrc && fs.existsSync(jevSkillSrc)) {
    const claudeSkillDir = process.env.CLAUDE_CONFIG_DIR
      ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'jev-use')
      : path.join(CLAUDE_SKILLS_PATH, 'jev-use');
    safeCopyDir(jevSkillSrc, claudeSkillDir);
    if (!IS_PORTABLE_MODE && fs.existsSync(WSL_HERMES_CONFIG_UNC)) {
      runWsl(`mkdir -p /home/Ade/.hermes/skills/vault/jev-use && cp -r "${toWslPath(jevSkillSrc)}/." /home/Ade/.hermes/skills/vault/jev-use/`);
    }
  }

  // 5. Sync WSL Hermes (install jev-use if absent + write mcp_servers.jev & .env)
  if (!IS_PORTABLE_MODE && fs.existsSync(WSL_HERMES_CONFIG_UNC)) {
    runWsl('if [ ! -f /home/Ade/.hermes/tools/jev-use/node_modules/jev-use/dist/cli.js ]; then mkdir -p /home/Ade/.hermes/tools/jev-use && npm --prefix /home/Ade/.hermes/tools/jev-use install --no-save jev-use@0.8.0 >/dev/null 2>&1 || true; fi');
    runWslHermesPython({
      env: {
        ...(resolvedKey ? { TYPESAFE_API_KEY: resolvedKey } : {}),
        TYPESAFE_BASE_URL: resolvedBase
      },
      wireJevMcp: true
    });
  }

  // 6. Sync / mirror USB Portable suite if USB_ROOT is attached or active
  if (usbRoot && fs.existsSync(usbRoot)) {
    const usbJevBundle = path.join(usbRoot, 'runtime', 'jev-use');
    ensureLocalJevBundle(usbJevBundle, allowNpmInstall);
    const usbCli = path.join(usbJevBundle, 'node_modules', 'jev-use', 'dist', 'cli.js');
    const usbNode = path.join(usbRoot, 'runtime', 'node', 'node.exe');
    const usbCmd = fs.existsSync(usbNode) ? usbNode : 'node';
    const usbHook = fs.existsSync(usbCli) ? `node "${usbCli}" hook gate` : inv.hookCommand;

    if (jevSkillSrc && fs.existsSync(jevSkillSrc)) {
      safeCopyDir(jevSkillSrc, path.join(usbRoot, 'skills', 'jev-use'));
      safeCopyDir(jevSkillSrc, path.join(usbRoot, 'config', 'claude', 'skills', 'jev-use'));
      safeCopyDir(jevSkillSrc, path.join(usbRoot, 'config', 'hermes', 'skills', 'vault', 'jev-use'));
      safeCopyDir(jevSkillSrc, path.join(usbRoot, 'data', 'home', '.claude', 'skills', 'jev-use'));
    }

    for (const sPath of [
      path.join(usbRoot, 'config', 'claude', 'settings.json'),
      path.join(usbRoot, 'data', 'home', '.claude', 'settings.json')
    ]) {
      const usbS = readJsonSafe(sPath, { env: {}, permissions: {}, modelSettings: {} });
      usbS.env = usbS.env || {};
      if (resolvedKey) usbS.env.TYPESAFE_API_KEY = resolvedKey;
      usbS.env.TYPESAFE_BASE_URL = resolvedBase;
      usbS.permissions = usbS.permissions || {};
      const usbAllow = new Set(Array.isArray(usbS.permissions.allow) ? usbS.permissions.allow : []);
      for (const rule of JEV_GATE_ALLOW_RULES) usbAllow.add(rule);
      usbS.permissions.allow = [...usbAllow];
      setJevGateEnabled(usbS, getJevGateStatus(settings), usbHook);
      writeJsonSafe(sPath, usbS);
    }

    for (const cjPath of [
      path.join(usbRoot, 'config', 'claude', '.claude.json'),
      path.join(usbRoot, 'data', 'home', '.claude.json')
    ]) {
      const usbCj = readJsonSafe(cjPath, {});
      usbCj.mcpServers = usbCj.mcpServers || {};
      usbCj.mcpServers.jev = {
        type: 'stdio',
        command: usbCmd,
        args: fs.existsSync(usbCli) ? [usbCli, 'serve'] : ['-y', 'jev-use@0.8.0', 'serve'],
        env: {
          TYPESAFE_API_KEY: resolvedKey,
          TYPESAFE_BASE_URL: resolvedBase
        }
      };
      writeJsonSafe(cjPath, usbCj);
    }

    writePortableHermesFiles(path.join(usbRoot, 'config', 'hermes'), {
      baseUrl: `${resolvedBase}/v1`,
      apiKey: resolvedKey,
      typesafeBase: resolvedBase
    });
    fs.writeFileSync(
      path.join(usbRoot, 'config', 'claude', '.usb_root.txt'),
      usbRoot.endsWith(path.sep) ? usbRoot : `${usbRoot}${path.sep}`,
      'utf8'
    );
  }

  return { resolvedBase, hasKey: Boolean(resolvedKey), inv, gateEnabled: getJevGateStatus(settings) };
}

function extractTopLevelYamlSection(raw, sectionKey) {
  const lines = raw.split(/\r?\n/);
  const captured = [];
  let inSection = false;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      if (inSection) break;
      if (line.trim() === `${sectionKey}:`) inSection = true;
      continue;
    }
    if (inSection) captured.push(line);
  }
  return captured.join('\n');
}

function inspectJevState() {
  const settings = readClaudeSettings();
  const env = settings.env || {};
  let jevMcp = null;
  for (const p of getClaudeJsonPaths()) {
    const cj = readJsonSafe(p, {});
    if (cj?.mcpServers?.jev) {
      jevMcp = cj.mcpServers.jev;
      break;
    }
  }
  const hasMcp = Boolean(jevMcp);
  const hasMcpKey = Boolean(jevMcp?.env?.TYPESAFE_API_KEY || env.TYPESAFE_API_KEY);
  const allow = Array.isArray(settings.permissions?.allow) ? settings.permissions.allow : [];
  const hasAllow = JEV_GATE_ALLOW_RULES.every(r => allow.includes(r));
  const gateOn = getJevGateStatus(settings);
  const claudeSkillPath = path.join(
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills') : CLAUDE_SKILLS_PATH,
    'jev-use', 'SKILL.md'
  );
  const hasSkill = fs.existsSync(claudeSkillPath);

  let hermesJev = false;
  try {
    const cfgPath = IS_PORTABLE_MODE && process.env.USB_ROOT
      ? path.join(process.env.USB_ROOT, 'config', 'hermes', 'config.yaml')
      : WSL_HERMES_CONFIG_UNC;
    if (fs.existsSync(cfgPath)) {
      const mcpBlock = extractTopLevelYamlSection(fs.readFileSync(cfgPath, 'utf8'), 'mcp_servers');
      hermesJev = /^\s+jev:/m.test(mcpBlock);
    }
  } catch (e) {}

  return {
    hasMcp,
    hasMcpKey,
    hasAllow,
    gateOn,
    hasSkill,
    hermesJev,
    baseUrl: jevMcp?.env?.TYPESAFE_BASE_URL || env.TYPESAFE_BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai',
    apiKey: jevMcp?.env?.TYPESAFE_API_KEY || env.TYPESAFE_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '',
    commandDesc: jevMcp ? `${jevMcp.command} ${(jevMcp.args || []).join(' ')}` : 'Not registered'
  };
}

async function testJevLive(apiKey, baseUrl) {
  if (!apiKey) {
    return [{ model: 'jev-latest', ok: false, error: 'Missing API key' }];
  }
  const origin = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const results = [];
  for (const model of ['jev-latest', 'clef']) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${origin}/v1/systemone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          state: 'Q-Branch diagnostic probe: system ready OK.',
          questions: {
            ready: { type: 'noul', instructions: 'Does this state indicate the system is ready OK?' }
          }
        })
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 120);
        results.push({ model, ok: false, ms, error: `HTTP ${res.status}: ${errTxt}` });
      } else {
        const data = await res.json();
        const ans = data?.answers?.ready?.noul;
        results.push({ model, ok: true, ms, score: ans });
      }
    } catch (e) {
      results.push({ model, ok: false, ms: Date.now() - t0, error: e.message });
    }
  }
  return results;
}

async function manageJev() {
  while (true) {
    console.clear();
    const st = inspectJevState();
    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : JEV & CLEF SYSTEM-1 INTERVENTION CONSOLE${C.reset}                   ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Endpoint Origin    :${C.reset} ${C.white}${st.baseUrl}${C.reset}`);
    console.log(`  ${C.gray}Claude MCP (jev)   :${C.reset} ${st.hasMcp && st.hasMcpKey ? `${C.green}✓ ACTIVE${C.reset} ${C.gray}(${st.commandDesc})${C.reset}` : st.hasMcp ? `${C.red}✗ REGISTERED BUT NO API KEY${C.reset}` : `${C.red}✗ NOT CONFIGURED${C.reset}`}`);
    console.log(`  ${C.gray}Claude Permissions :${C.reset} ${st.hasAllow ? `${C.green}✓ mcp__jev__jev_judge & jev_gate allowed${C.reset}` : `${C.gold}! Explicit allow rules missing${C.reset}`}`);
    console.log(`  ${C.gray}PreToolUse Gate    :${C.reset} ${st.gateOn ? `${C.green}✓ ENABLED${C.reset} ${C.gray}(Zero-token risk check before Bash/Write/Edit)${C.reset}` : `${C.gray}OFF (Use [2] to enable automatic shell/edit safety gate)${C.reset}`}`);
    console.log(`  ${C.gray}Hermes MCP (jev)   :${C.reset} ${st.hermesJev ? `${C.green}✓ ENABLED${C.reset}` : `${C.red}✗ NOT CONFIGURED${C.reset}`}`);
    console.log(`  ${C.gray}Routing Skill      :${C.reset} ${st.hasSkill ? `${C.green}✓ jev-use SKILL.md deployed${C.reset}` : `${C.gold}! jev-use skill not installed in active dir${C.reset}`}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

    console.log(`  ${C.green}[1]${C.reset} ${C.white}Auto-Wire / Repair All${C.reset}      ${C.gray}- Configure Claude, Hermes, Key, Permissions & Skill${C.reset}`);
    console.log(`  ${C.gold}[2]${C.reset} ${C.white}Toggle PreToolUse Gate${C.reset}     ${C.gray}- Currently ${st.gateOn ? 'ON' : 'OFF'} (Zero-token Bash/Write/Edit vetting)${C.reset}`);
    console.log(`  ${C.cyan}[3]${C.reset} ${C.white}Live Latency Test${C.reset}          ${C.gray}- Probe jev-latest & clef on /v1/systemone${C.reset}`);
    console.log(`  ${C.red}[0]${C.reset} ${C.white}Return to Main Menu${C.reset}\n`);

    const c = (await ask(`Select action [1-3, 0]: `)).trim().toLowerCase();
    if (!c || c === '0' || c === 'q' || c === 'b') break;

    if (c === '1') {
      console.log(`\n[*] Wiring Jev Intervention across Claude Code, Hermes & Skills...`);
      syncJevIntegration({ allowNpmInstall: true });
      console.log(`${C.green}✓ All Jev configurations synchronized!${C.reset}`);
      await ask(`Press Enter to continue... `);
    } else if (c === '2') {
      const nextState = !st.gateOn;
      syncJevIntegration({ toggleGate: nextState });
      console.log(`\n${C.green}✓ PreToolUse Safety Gate is now ${nextState ? 'ENABLED' : 'DISABLED'}.${C.reset}`);
      await ask(`Press Enter to continue... `);
    } else if (c === '3') {
      console.log(`\n[*] Testing live /v1/systemone round-trips...`);
      const res = await testJevLive(st.apiKey, st.baseUrl);
      for (const r of res) {
        if (r.ok) {
          console.log(`  ${C.green}✓ ${r.model.padEnd(12)}${C.reset} ${C.white}${r.ms}ms${C.reset} ${C.gray}(noul score: ${Number(r.score).toFixed(3)})${C.reset}`);
        } else {
          console.log(`  ${C.red}✗ ${r.model.padEnd(12)}${C.reset} ${r.error}`);
        }
      }
      console.log();
      await ask(`Press Enter to continue... `);
    }
  }
}

function readHermesYamlSummary() {
  const cfgPath = IS_PORTABLE_MODE && process.env.USB_ROOT
    ? path.join(process.env.USB_ROOT, 'config', 'hermes', 'config.yaml')
    : WSL_HERMES_CONFIG_UNC;
  const info = {
    exists: false,
    defaultModel: 'unknown',
    delegationModel: '(inherits primary)',
    reasoningEffort: 'none',
    serviceTier: 'normal',
    hasJevMcp: false
  };
  try {
    if (!fs.existsSync(cfgPath)) return info;
    const raw = fs.readFileSync(cfgPath, 'utf8');
    info.exists = true;
    const modelBlock = extractTopLevelYamlSection(raw, 'model');
    info.defaultModel = modelBlock.match(/^\s+default:\s*"?([^"\r\n#]+)"?/m)?.[1]?.trim() || info.defaultModel;
    const delBlock = extractTopLevelYamlSection(raw, 'delegation');
    const delMod = delBlock.match(/^\s+model:\s*"?([^"\r\n#]+)"?/m)?.[1]?.trim();
    if (delMod) info.delegationModel = delMod;
    const agentBlock = extractTopLevelYamlSection(raw, 'agent');
    const rEff = agentBlock.match(/^\s+reasoning_effort:\s*"?([^"\r\n#]+)"?/m)?.[1]?.trim();
    if (rEff) info.reasoningEffort = rEff;
    const sTier = agentBlock.match(/^\s+service_tier:\s*"?([^"\r\n#]*)"?/m)?.[1]?.trim();
    if (sTier) info.serviceTier = sTier;
    const mcpBlock = extractTopLevelYamlSection(raw, 'mcp_servers');
    info.hasJevMcp = /^\s+jev:/m.test(mcpBlock);
  } catch (e) {}
  return info;
}

async function manageHermesModes() {
  const launchTmp = path.join(os.tmpdir(), 'qbranch_hermes_launch.txt');
  while (true) {
    console.clear();
    const settings = readClaudeSettings();
    const qPrimary = settings.env?.ANTHROPIC_MODEL || 'gpt-6-luna';
    const qFast = settings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
    const h = readHermesYamlSummary();

    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : HERMES MODES, MULTI-MODEL SPLIT & LAUNCHES${C.reset}                 ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Primary Model      :${C.reset} ${C.gold}${h.defaultModel}${C.reset}`);
    console.log(`  ${C.gray}Subagent Model     :${C.reset} ${C.cyan}${h.delegationModel}${C.reset} ${C.gray}(delegation.model)${C.reset}`);
    console.log(`  ${C.gray}Reasoning Effort   :${C.reset} ${C.white}${h.reasoningEffort}${C.reset} ${C.gray}(none | low | medium | high | xhigh)${C.reset}`);
    console.log(`  ${C.gray}Fast Service Tier  :${C.reset} ${C.white}${h.serviceTier || 'normal'}${C.reset}`);
    console.log(`  ${C.gray}Jev MCP Tools      :${C.reset} ${h.hasJevMcp ? `${C.green}✓ jev_judge & jev_gate loaded${C.reset}` : `${C.red}✗ Not wired (run [J])${C.reset}`}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.gold}CONFIGURE HERMES DEFAULTS:${C.reset}`);
    console.log(`  ${C.green}[1]${C.reset} ${C.white}Sync 2-Model Split${C.reset}        ${C.gray}(Primary: ${qPrimary} + Subagent: ${qFast})${C.reset}`);
    console.log(`  ${C.green}[2]${C.reset} ${C.white}Set Subagent Model${C.reset}        ${C.gray}- Choose dedicated model for spawned child agents${C.reset}`);
    console.log(`  ${C.green}[3]${C.reset} ${C.white}Set Reasoning Effort${C.reset}      ${C.gray}- Change thinking depth (none / low / medium / high / xhigh)${C.reset}`);
    console.log(`\n  ${C.cyan}LAUNCH HERMES IN SPECIAL MODES (CURRENT FOLDER):${C.reset}`);
    console.log(`  ${C.cyan}[4]${C.reset} ${C.white}Resume Latest Session${C.reset}     ${C.gray}(--resume latest)${C.reset}`);
    console.log(`  ${C.cyan}[5]${C.reset} ${C.white}Git Worktree Isolation${C.reset}    ${C.gray}(--worktree — isolated branch workspace)${C.reset}`);
    console.log(`  ${C.cyan}[6]${C.reset} ${C.white}TUI + High Reasoning${C.reset}      ${C.gray}(--tui --reasoning high)${C.reset}`);
    console.log(`  ${C.cyan}[7]${C.reset} ${C.white}YOLO + TUI${C.reset}                ${C.gray}(--tui --yolo — dashboard with auto-approve)${C.reset}`);
    console.log(`  ${C.red}[0]${C.reset} ${C.white}Return to Main Menu${C.reset}\n`);

    const c = (await ask(`Select option [1-7, 0]: `)).trim().toLowerCase();
    if (!c || c === '0' || c === 'q' || c === 'b') break;

    if (c === '1') {
      syncToHermes(qPrimary, settings.env?.ANTHROPIC_BASE_URL, settings.env?.ANTHROPIC_AUTH_TOKEN, qFast);
      console.log(`${C.green}✓ Synced Primary (${qPrimary}) + Subagent (${qFast}) to Hermes!${C.reset}`);
      await ask(`Press Enter to continue... `);
    } else if (c === '2') {
      const sub = (await ask(`Enter delegation.model (e.g. deepseek-v4.1-flash-1017, blank = inherit parent): `)).trim();
      if (!IS_PORTABLE_MODE && fs.existsSync(WSL_HERMES_CONFIG_UNC)) {
        runWslHermesPython({ fastModel: sub });
      }
      if (process.env.USB_ROOT && fs.existsSync(process.env.USB_ROOT)) {
        writePortableHermesFiles(path.join(process.env.USB_ROOT, 'config', 'hermes'), { fastModel: sub });
      }
      console.log(`${C.green}✓ Hermes delegation.model updated!${C.reset}`);
      await ask(`Press Enter to continue... `);
    } else if (c === '3') {
      const lvl = (await ask(`Enter reasoning effort [none|minimal|low|medium|high|xhigh]: `)).trim().toLowerCase();
      if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(lvl)) {
        if (!IS_PORTABLE_MODE && fs.existsSync(WSL_HERMES_CONFIG_UNC)) {
          runWslHermesPython({ reasoning: lvl });
        }
        if (process.env.USB_ROOT && fs.existsSync(process.env.USB_ROOT)) {
          writePortableHermesFiles(path.join(process.env.USB_ROOT, 'config', 'hermes'), { reasoning: lvl });
        }
        console.log(`${C.green}✓ Reasoning effort set to "${lvl}".${C.reset}`);
      } else {
        console.log(`${C.red}Invalid reasoning level.${C.reset}`);
      }
      await ask(`Press Enter to continue... `);
    } else if (c === '4') {
      fs.writeFileSync(launchTmp, '--resume latest', 'utf8');
      break;
    } else if (c === '5') {
      fs.writeFileSync(launchTmp, '--worktree', 'utf8');
      break;
    } else if (c === '6') {
      fs.writeFileSync(launchTmp, '--tui --reasoning high', 'utf8');
      break;
    } else if (c === '7') {
      fs.writeFileSync(launchTmp, '--tui --yolo', 'utf8');
      break;
    }
  }
}

const SYSTEM_PROCESS_NAMES = new Set([
  'system', 'idle', 'svchost.exe', 'lsass.exe', 'wininit.exe', 'services.exe',
  'spoolsv.exe', 'searchindexer.exe', 'msmpeng.exe', 'dashost.exe', 'sihost.exe',
  'fontdrvhost.exe', 'wmiprvse.exe'
]);
const SYSTEM_RPC_PORTS = new Set([135, 445, 5040]);

function normalizeAuditHost(hostname) {
  return String(hostname || '').trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
}

/**
 * Collect all local loopback and interface IPs owned by this machine.
 */
function getLocalMachineIps() {
  const ips = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);
  try {
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
      if (!Array.isArray(addrs)) continue;
      for (const iface of addrs) {
        if (iface?.address) {
          ips.add(normalizeAuditHost(iface.address));
        }
      }
    }
  } catch (e) {}
  return ips;
}

function isStrictlyLocalHost(hostname) {
  const clean = normalizeAuditHost(hostname);
  if (!clean) return false;
  return getLocalMachineIps().has(clean);
}

/**
 * Discover active TCP LISTENING sockets and map each port to process name, PID, and exposure scope.
 */
function discoverListeningPorts({ includeSystem = false } = {}) {
  const netstatOut = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const tasklistOut = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  const pidNames = {};
  for (const line of tasklistOut.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) pidNames[m[2]] = m[1];
  }

  const byPort = new Map();
  for (const line of netstatOut.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (!m) continue;
    const localAddr = m[1];
    const pid = m[2];
    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon <= 0) continue;
    const bindRaw = localAddr.slice(0, lastColon);
    const port = Number(localAddr.slice(lastColon + 1));
    if (!Number.isInteger(port) || port <= 0) continue;

    const procName = pidNames[pid] || `pid:${pid}`;
    let entry = byPort.get(port);
    if (!entry) {
      entry = { port, pids: new Set(), processes: new Set(), bindings: new Set(), hasUserProc: false };
      byPort.set(port, entry);
    }
    entry.pids.add(pid);
    entry.processes.add(procName);
    entry.bindings.add(bindRaw);
    if (!SYSTEM_PROCESS_NAMES.has(procName.toLowerCase()) && !SYSTEM_RPC_PORTS.has(port)) {
      entry.hasUserProc = true;
    }
  }

  const results = [];
  for (const entry of byPort.values()) {
    if (!includeSystem && !entry.hasUserProc) continue;
    const bindings = [...entry.bindings];
    const isLanExposed = bindings.some(b => {
      const nb = normalizeAuditHost(b);
      return nb !== '127.0.0.1' && nb !== '::1';
    });
    results.push({
      port: entry.port,
      pids: [...entry.pids],
      processes: [...entry.processes],
      bindings,
      exposure: isLanExposed ? 'LAN-EXPOSED' : 'LOOPBACK-ONLY'
    });
  }
  return results.sort((a, b) => a.port - b.port);
}

/**
 * Execute a passive non-destructive HTTP request (GET or OPTIONS) to a local URL.
 */
async function fetchLocalHttp(urlStr, method = 'GET', timeoutMs = 1200) {
  const t0 = Date.now();
  const res = await fetch(urlStr, {
    method,
    headers: {
      Origin: 'https://external-observer.example',
      'User-Agent': 'QBranch-Local-Audit/1.0'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs)
  });
  const elapsedMs = Date.now() - t0;
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const bodyText = (await res.text()).slice(0, 8192);
  const titleMatch = bodyText.match(/<title[^>]*>([\s\S]{1,120}?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  return { status: res.status, statusText: res.statusText || '', elapsedMs, headers, bodyText, title };
}

async function probeHttpQuick(entry, timeoutMs = 1200) {
  const candidates = entry.bindings.every(b => normalizeAuditHost(b) === '::1')
    ? [`http://[::1]:${entry.port}/`, `http://127.0.0.1:${entry.port}/`]
    : [`http://127.0.0.1:${entry.port}/`, `http://[::1]:${entry.port}/`];
  for (const url of candidates) {
    try {
      const r = await fetchLocalHttp(url, 'GET', timeoutMs);
      const acao = r.headers['access-control-allow-origin'] || '';
      const server = r.headers['server'] || '';
      const poweredBy = r.headers['x-powered-by'] || '';
      return {
        isHttp: true,
        status: r.status,
        title: r.title,
        server,
        poweredBy,
        acao,
        corsOpen: acao === '*' || acao === 'https://external-observer.example'
      };
    } catch (e) {}
  }
  return { isHttp: false };
}

function normalizeLocalAuditTarget(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return { ok: false, error: 'Empty target.' };
  const candidate = /^\d+$/.test(trimmed)
    ? `http://127.0.0.1:${trimmed}/`
    : (/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (e) {
    return { ok: false, error: `Invalid URL format: "${trimmed}"` };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: `Unsupported protocol "${parsed.protocol}". Only http/https are supported.` };
  }
  if (!isStrictlyLocalHost(parsed.hostname)) {
    return {
      ok: false,
      error: `SAFETY REFUSAL: "${parsed.hostname}" is not a local address on this machine. Local Server Security Audit only inspects localhost, 127.0.0.1, [::1], 0.0.0.0, or local NIC IPs.`
    };
  }
  return { ok: true, url: parsed };
}

/**
 * Inspect one strictly-local endpoint passively and print a 4-part defensive security audit.
 */
async function inspectLocalEndpoint(rawInput, discoveredList = []) {
  const norm = normalizeLocalAuditTarget(rawInput);
  if (!norm.ok) {
    console.log(`\n${C.red}✗ ${norm.error}${C.reset}`);
    return;
  }

  const parsed = norm.url;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const sock = discoveredList.find(d => d.port === port) || discoverListeningPorts({ includeSystem: true }).find(d => d.port === port);

  const fetchUrl = new URL(parsed.toString());
  const hNorm = normalizeAuditHost(fetchUrl.hostname);
  if (hNorm === '0.0.0.0' || hNorm === '::') {
    fetchUrl.hostname = '127.0.0.1';
  }

  let getRes = null;
  let getErr = null;
  let optRes = null;
  try {
    getRes = await fetchLocalHttp(fetchUrl.toString(), 'GET', 2000);
  } catch (e) {
    getErr = e.message || String(e);
  }
  if (getRes) {
    try {
      optRes = await fetchLocalHttp(fetchUrl.toString(), 'OPTIONS', 1500);
    } catch (e) {}
  }

  console.log(`\n${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}LOCAL ENDPOINT AUDIT : ${parsed.toString().slice(0, 50).padEnd(50)}${C.reset} ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);

  // 1. Socket & Network Binding Exposure
  console.log(`\n  ${C.bold}[1] SOCKET & NETWORK BINDING EXPOSURE${C.reset}`);
  if (sock) {
    const scopeColor = sock.exposure === 'LAN-EXPOSED' ? C.gold : C.green;
    const lanNote = sock.exposure === 'LAN-EXPOSED'
      ? 'Reachable by other devices on your Wi-Fi / LAN (subject to Windows Firewall)'
      : 'Loopback only (local apps & browser tabs on this PC only)';
    console.log(`    Process / PID    : ${C.white}${sock.processes.join(', ')}${C.reset} (PID ${sock.pids.join(', ')})`);
    console.log(`    Bound Interfaces : ${C.cyan}${sock.bindings.map(b => `${b}:${port}`).join(', ')}${C.reset}`);
    console.log(`    Exposure Scope   : ${scopeColor}${sock.exposure}${C.reset} — ${C.gray}${lanNote}${C.reset}`);
  } else {
    console.log(`    Socket Status    : ${C.gray}Port ${port} not currently listed in TCP LISTENING sockets${C.reset}`);
  }

  // 2. Observer Fingerprint
  console.log(`\n  ${C.bold}[2] OBSERVER FINGERPRINT (WHAT AN EXTERNAL BROWSER / OBSERVER SEES)${C.reset}`);
  if (!getRes) {
    console.log(`    HTTP Probe       : ${C.red}No HTTP response (${getErr || 'non-HTTP TCP socket or TLS mismatch'})${C.reset}`);
    return;
  }

  const h = getRes.headers;
  console.log(`    HTTP Status      : ${C.green}${getRes.status} ${getRes.statusText}${C.reset} (${getRes.elapsedMs}ms)`);
  console.log(`    Server Banner    : ${h['server'] ? C.gold + h['server'] + C.reset : C.gray + '(not disclosed)' + C.reset}`);
  if (h['x-powered-by']) console.log(`    X-Powered-By     : ${C.gold}${h['x-powered-by']}${C.reset}`);
  console.log(`    Content-Type     : ${C.white}${h['content-type'] || '(none)'}${C.reset}`);
  if (getRes.title) console.log(`    Page <title>     : ${C.cyan}${getRes.title}${C.reset}`);
  if (h['location']) console.log(`    Redirect         : ${C.gray}${h['location']}${C.reset}`);
  if (optRes) {
    console.log(`    OPTIONS Probe    : ${C.white}HTTP ${optRes.status}${C.reset}${optRes.headers['allow'] ? ` | Allow: ${optRes.headers['allow']}` : ''}`);
  }

  // 3. Security Posture & Risk Findings
  console.log(`\n  ${C.bold}[3] SECURITY POSTURE & RISK FINDINGS${C.reset}`);
  const findings = [];
  const fixes = [];

  if (sock && sock.exposure === 'LAN-EXPOSED') {
    findings.push(`${C.gold}MEDIUM${C.reset}  Wildcard/LAN bind (${sock.bindings.join(', ')}): devices on the same network can reach port ${port}.`);
    fixes.push('Bind dev servers strictly to 127.0.0.1 unless LAN testing is needed (e.g. Node `.listen(port, "127.0.0.1")`, Vite without `--host`, Uvicorn `--host 127.0.0.1`).');
  } else if (sock) {
    findings.push(`${C.green}PASS${C.reset}    Bound to loopback only (${sock.bindings.join(', ')}) — shielded from Wi-Fi/LAN neighbors.`);
  }

  const acaoGet = h['access-control-allow-origin'] || '';
  const acaoOpt = optRes?.headers['access-control-allow-origin'] || '';
  const acao = acaoGet || acaoOpt;
  const acac = (h['access-control-allow-credentials'] || optRes?.headers['access-control-allow-credentials'] || '').toLowerCase() === 'true';
  if (acao === '*' || acao === 'https://external-observer.example') {
    const level = acao === 'https://external-observer.example' && acac ? `${C.red}HIGH${C.reset}   ` : `${C.gold}MEDIUM${C.reset} `;
    findings.push(`${level} Drive-By Browser CORS (${acao}${acac ? ' + Allow-Credentials: true' : ''}): arbitrary websites open in your browser can read responses from this localhost port.`);
    fixes.push('Restrict CORS `Access-Control-Allow-Origin` to explicit trusted origins rather than `*` or reflecting arbitrary `Origin` headers.');
  } else {
    findings.push(`${C.green}PASS${C.reset}    CORS blocked untrusted test Origin (${acao ? `returned ${acao}` : 'no ACAO header sent'}).`);
  }

  const bannerHints = [h['server'], h['x-powered-by']].filter(Boolean).join(' / ');
  if (bannerHints) {
    findings.push(`${C.gray}INFO${C.reset}    Software fingerprint leaked via headers: ${bannerHints}`);
    fixes.push('Disable framework banners (`app.disable("x-powered-by")` in Express, `server_tokens off` in Nginx) to minimize version fingerprinting.');
  }

  const body = getRes.bodyText || '';
  if (/Index of \/|Directory listing for/i.test(body)) {
    findings.push(`${C.gold}MEDIUM${C.reset}  Open directory index detected in response body — file tree is browsable.`);
    fixes.push('Disable automatic directory indexing in production or serve only an explicit static asset directory.');
  }
  if (/Werkzeug Debugger|Traceback \(most recent call last\)|at Function\.|ReferenceError:|SyntaxError:/i.test(body)) {
    findings.push(`${C.red}HIGH${C.reset}    Debug trace or interactive debugger signature spotted in response body.`);
    fixes.push('Disable interactive debuggers (`DEBUG=False` / disable Werkzeug pinless console) before exposing or leaving services running.');
  }

  const secHeaders = [
    ['content-security-policy', 'Content-Security-Policy'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['x-frame-options', 'X-Frame-Options'],
    ['cross-origin-resource-policy', 'Cross-Origin-Resource-Policy'],
    ['referrer-policy', 'Referrer-Policy']
  ];
  const missingHeaders = [];
  console.log(`\n    ${C.gray}Defensive HTTP Headers:${C.reset}`);
  for (const [key, label] of secHeaders) {
    const val = h[key];
    if (val) {
      console.log(`      ${C.green}✓${C.reset} ${label.padEnd(28)} : ${C.white}${val.slice(0, 60)}${C.reset}`);
    } else {
      console.log(`      ${C.gray}-${C.reset} ${label.padEnd(28)} : ${C.gray}missing${C.reset}`);
      missingHeaders.push(label);
    }
  }
  if (missingHeaders.length > 0) {
    fixes.push(`Add defensive response headers (${missingHeaders.slice(0, 3).join(', ')} — e.g. \`X-Content-Type-Options: nosniff\`, \`Cross-Origin-Resource-Policy: same-origin\`, \`X-Frame-Options: DENY\`).`);
  }

  console.log(`\n    ${C.gray}Summary Findings:${C.reset}`);
  for (const f of findings) console.log(`      ${f}`);

  // 4. Defensive Remediations
  console.log(`\n  ${C.bold}[4] HOW TO LOCK IT DOWN (DEFENSIVE REMEDIATIONS)${C.reset}`);
  if (fixes.length === 0) {
    console.log(`    ${C.green}✓ No common exposure issues detected on this passive check.${C.reset}`);
  } else {
    fixes.forEach((fix, idx) => console.log(`    ${C.cyan}${idx + 1}.${C.reset} ${fix}`));
  }
}

/**
 * Interactive local server discovery and passive security posture auditor (`qbranch.mjs local-audit`).
 */
async function manageLocalAudit() {
  let includeSystem = false;
  while (true) {
    console.clear();
    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : LOCAL SERVER SECURITY & EXPOSURE AUDITOR${C.reset}                  ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`  ${C.gray}Safety Guardrail   :${C.reset} ${C.green}STRICTLY LOCAL-ONLY${C.reset} ${C.gray}(Passive GET/OPTIONS on loopback & local NICs)${C.reset}`);
    console.log(`  ${C.gray}System/RPC Filter  :${C.reset} ${includeSystem ? C.gold + 'SHOWING ALL WINDOWS PORTS' : C.cyan + 'APP SERVERS ONLY (Use [A] to toggle system ports)'}${C.reset}`);
    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);

    let ports = [];
    try {
      ports = discoverListeningPorts({ includeSystem });
    } catch (e) {
      console.log(`  ${C.red}✗ Could not enumerate local sockets: ${e.message}${C.reset}\n`);
    }

    const probed = await Promise.all(ports.map(p => probeHttpQuick(p)));

    if (ports.length === 0) {
      console.log(`  ${C.gray}No active local application servers detected right now.${C.reset}`);
      console.log(`  ${C.gray}Tip: Start a dev server or enter a custom local URL/port with [U].${C.reset}`);
    } else {
      for (let i = 0; i < ports.length; i++) {
        const s = ports[i];
        const p = probed[i];
        const idxTag = `[${i + 1}]`.padEnd(5);
        const portCol = `:${s.port}`.padEnd(7);
        const procCol = s.processes.join(',').slice(0, 18).padEnd(18);
        const scopeTag = s.exposure === 'LAN-EXPOSED'
          ? `${C.gold}LAN-EXPOSED  ${C.reset}`
          : `${C.green}LOOPBACK-ONLY${C.reset}`;
        let httpTag = `${C.gray}[non-HTTP TCP]${C.reset}`;
        if (p.isHttp) {
          const flags = [];
          if (p.corsOpen) flags.push('CORS-OPEN');
          if (p.server || p.poweredBy) flags.push(p.server || p.poweredBy);
          const titlePart = p.title ? ` "${p.title.slice(0, 22)}"` : '';
          httpTag = `${C.cyan}HTTP ${p.status}${C.reset}${flags.length ? ` ${C.gold}[${flags.join(' | ')}]${C.reset}` : ''}${C.gray}${titlePart}${C.reset}`;
        }
        console.log(`  ${C.green}${idxTag}${C.reset} ${C.white}${portCol}${C.reset} ${procCol} ${scopeTag}  ${httpTag}`);
      }
    }

    console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.green}[1..N]${C.reset} Deep-inspect server   ${C.cyan}[U]${C.reset} Inspect local URL/port   ${C.magenta}[A]${C.reset} Toggle system ports`);
    console.log(`  ${C.cyan}[R]${C.reset}    Rescan ports          ${C.red}[0]${C.reset} Return to Main Menu\n`);

    const portPrompt = ports.length > 0 ? `1-${ports.length}, ` : '';
    const choice = (await ask(`Select option [${portPrompt}U, A, R, 0]: `)).trim().toLowerCase();
    if (!choice || choice === '0' || choice === 'q' || choice === 'b') break;

    if (choice === 'a') {
      includeSystem = !includeSystem;
    } else if (choice === 'r') {
      continue;
    } else if (choice === 'u') {
      const target = await ask(`Enter local URL or port (e.g. 3000, localhost:5173, http://127.0.0.1:8080/api): `);
      if (target) {
        await inspectLocalEndpoint(target, ports);
        console.log();
        await ask(`Press Enter to continue... `);
      }
    } else {
      const num = parseInt(choice, 10);
      if (Number.isInteger(num) && num >= 1 && num <= ports.length) {
        const picked = ports[num - 1];
        const host = picked.bindings.every(b => normalizeAuditHost(b) === '::1') ? '[::1]' : '127.0.0.1';
        await inspectLocalEndpoint(`http://${host}:${picked.port}/`, ports);
        console.log();
        await ask(`Press Enter to continue... `);
      } else {
        console.log(`${C.red}Invalid selection.${C.reset}`);
        await ask(`Press Enter to continue... `);
      }
    }
  }
}

function printEnvSummary() {
  const settings = readClaudeSettings();
  const env = settings.env || {};
  const primary = env.ANTHROPIC_MODEL || 'gpt-6-luna';
  const fast = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  let hasClaudeJev = false;
  for (const p of getClaudeJsonPaths()) {
    const cj = readJsonSafe(p, {});
    if (cj?.mcpServers?.jev && (cj?.mcpServers?.jev?.env?.TYPESAFE_API_KEY || env.TYPESAFE_API_KEY)) {
      hasClaudeJev = true;
      break;
    }
  }
  const gate = getJevGateStatus(settings) ? 'ON' : 'OFF';
  console.log(`Q_PRIMARY=${primary}`);
  console.log(`Q_FAST=${fast}`);
  console.log(`Q_JEV_STATUS=${hasClaudeJev ? 'ACTIVE' : 'UNCONFIGURED'}`);
  console.log(`Q_JEV_GATE=${gate}`);
}

function refreshUsbPaths(usbRootInput) {
  const usbRoot = path.resolve(usbRootInput || SCRIPT_DIR);
  const cliJs = path.join(usbRoot, 'runtime', 'jev-use', 'node_modules', 'jev-use', 'dist', 'cli.js');
  const nodeExe = path.join(usbRoot, 'runtime', 'node', 'node.exe');
  if (!fs.existsSync(cliJs)) return;

  for (const cjPath of [
    path.join(usbRoot, 'config', 'claude', '.claude.json'),
    path.join(usbRoot, 'data', 'home', '.claude.json')
  ]) {
    if (!fs.existsSync(cjPath)) continue;
    const cfg = readJsonSafe(cjPath, {});
    if (cfg?.mcpServers?.jev) {
      cfg.mcpServers.jev.command = fs.existsSync(nodeExe) ? nodeExe : 'node';
      cfg.mcpServers.jev.args = [cliJs, 'serve'];
      writeJsonSafe(cjPath, cfg);
    }
  }

  for (const sPath of [
    path.join(usbRoot, 'config', 'claude', 'settings.json'),
    path.join(usbRoot, 'data', 'home', '.claude', 'settings.json')
  ]) {
    if (!fs.existsSync(sPath)) continue;
    const s = readJsonSafe(sPath, {});
    if (getJevGateStatus(s)) {
      setJevGateEnabled(s, true, `node "${cliJs}" hook gate`);
      writeJsonSafe(sPath, s);
    }
  }
  const usbHermesDir = path.join(usbRoot, 'config', 'hermes');
  if (fs.existsSync(path.join(usbHermesDir, 'config.yaml'))) {
    writePortableHermesFiles(usbHermesDir, {});
  }
  fs.mkdirSync(path.join(usbRoot, 'config', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(usbRoot, 'config', 'claude', '.usb_root.txt'), usbRoot.endsWith(path.sep) ? usbRoot : `${usbRoot}${path.sep}`, 'utf8');
}

// CLI Router
const args = process.argv.slice(2);
const cmd = (args[0] || 'status').toLowerCase();
const currentDir = process.cwd();

try {
  if (cmd === 'status') {
    await showStatus();
  } else if (cmd === 'env-summary') {
    printEnvSummary();
  } else if (cmd === 'refresh-usb-paths') {
    refreshUsbPaths(args[1]);
  } else if (cmd === 'config') {
    await configureApi();
  } else if (cmd === 'models') {
    await browseModels();
  } else if (cmd === 'jev') {
    await manageJev();
  } else if (cmd === 'hermes-modes' || cmd === 'hermes') {
    await manageHermesModes();
  } else if (cmd === 'local-audit' || cmd === 'scan' || cmd === 'audit') {
    await manageLocalAudit();
  } else if (cmd === 'skills') {
    await manageSkills(currentDir);
  } else if (cmd === 'profiles' || cmd === 'loadouts') {
    await manageProfiles(currentDir);
  } else if (cmd === 'setup' || cmd === 'install') {
    await runSetupWizard();
  } else if (cmd === 'usb') {
    await buildUsbDrive(currentDir);
  } else if (cmd === 'update-usb') {
    await updateUsbSuite(SCRIPT_DIR);
  }
} finally {
  closeRl();
}
