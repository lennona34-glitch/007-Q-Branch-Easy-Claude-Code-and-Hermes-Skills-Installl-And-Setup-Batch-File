#!/usr/bin/env node
/**
 * 007 Q-Branch Direct Agent (Zero-Dependency Autonomous Coding CLI)
 * Runs natively on Node.js 20+ (including macOS 10.15 Catalina Intel x64, modern macOS, Linux & Windows)
 * Uses your synced Experiential Labs API key, active 2-model split, Jev System-1 endpoint & Q-Branch skills.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const USER_HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

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

// Parse CLI args
const argv = process.argv.slice(2);
let yoloMode = false;
let modelOverride = '';
let oneShotPrompt = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--yolo' || a === '-y') yoloMode = true;
  else if ((a === '-m' || a === '--model') && argv[i + 1]) modelOverride = argv[++i];
  else if ((a === '-p' || a === '--prompt') && argv[i + 1]) oneShotPrompt = argv[++i];
}

function readJsonSafe(p, fallback = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return fallback;
}

function loadConfig() {
  const candidates = [
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json') : null,
    process.env.QBRANCH_MAC_HOME ? path.join(process.env.QBRANCH_MAC_HOME, 'config', 'claude', 'settings.json') : null,
    path.join(USER_HOME, '.claude', 'settings.json'),
    path.join(SCRIPT_DIR, 'config', 'claude', 'settings.json')
  ].filter(Boolean);

  let env = {};
  for (const p of candidates) {
    const s = readJsonSafe(p, null);
    if (s && s.env) {
      env = { ...s.env };
      break;
    }
  }

  const baseRaw = process.env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const baseOrigin = baseRaw.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.OPENAI_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.TYPESAFE_API_KEY || '';
  const primaryModel = modelOverride || env.ANTHROPIC_MODEL || 'gpt-6-luna';
  const fastModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';
  return { baseOrigin, apiKey, primaryModel, fastModel };
}

function getSkillSearchDirs() {
  return [
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills') : null,
    process.env.HERMES_HOME ? path.join(process.env.HERMES_HOME, 'skills', 'vault') : null,
    process.env.QBRANCH_MAC_HOME ? path.join(process.env.QBRANCH_MAC_HOME, 'skills') : null,
    path.join(SCRIPT_DIR, 'skills'),
    path.join(USER_HOME, '.claude', 'skills')
  ].filter(d => d && fs.existsSync(d));
}

function listAvailableSkills() {
  const found = new Map();
  for (const dir of getSkillSearchDirs()) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const skillMd = path.join(dir, name, 'SKILL.md');
        if (fs.existsSync(skillMd) && !found.has(name)) {
          found.set(name, skillMd);
        }
      }
    } catch (e) {}
  }
  return found;
}

let rl = null;
function getRl() {
  if (!rl || rl.closed) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY)
    });
  }
  return rl;
}

function ask(prompt) {
  if (process.stdin.readableEnded) return Promise.resolve('');
  return new Promise(resolve => {
    const r = getRl();
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(typeof v === 'string' ? v : '');
      }
    };
    r.question(prompt, finish);
    r.once('close', () => finish(''));
  });
}

async function confirmAction(summary) {
  if (yoloMode) return true;
  if (oneShotPrompt) return false;
  const ans = (await ask(`${C.gold}Approve action? ${C.white}${summary}${C.gold} [y/N/a(ll)]: ${C.reset}`)).trim().toLowerCase();
  if (ans === 'a' || ans === 'all') {
    yoloMode = true;
    console.log(`${C.gold}[*] YOLO auto-approve enabled for this session.${C.reset}`);
    return true;
  }
  return ans === 'y' || ans === 'yes';
}

function resolveWorkspacePath(relOrAbs) {
  return path.resolve(process.cwd(), relOrAbs || '.');
}

function walkTree(dir, depth = 0, maxDepth = 3, out = []) {
  if (depth > maxDepth || out.length >= 250) return out;
  const skip = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', '.DS_Store']);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (skip.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(process.cwd(), full) || ent.name;
    out.push(ent.isDirectory() ? `${rel}/` : rel);
    if (out.length >= 250) break;
    if (ent.isDirectory() && depth < maxDepth) {
      walkTree(full, depth + 1, maxDepth, out);
    }
  }
  return out;
}

function searchFilesText(pattern, startDir) {
  const matches = [];
  const root = resolveWorkspacePath(startDir || '.');
  let regex;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (e) {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const files = walkTree(root, 0, 5, []).filter(f => !f.endsWith('/'));
  for (const rel of files) {
    if (matches.length >= 80) break;
    const full = path.resolve(process.cwd(), rel);
    try {
      const stat = fs.statSync(full);
      if (stat.size > 512 * 1024) continue;
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${rel}:${i + 1}: ${lines[i].slice(0, 180)}`);
          if (matches.length >= 80) break;
        }
      }
    } catch (e) {}
  }
  return matches.length ? matches.join('\n') : 'No matches found.';
}

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command in the current working directory and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          cwd: { type: 'string', description: 'Optional working directory relative or absolute' }
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
          file_path: { type: 'string', description: 'Path to file' },
          start_line: { type: 'integer', description: '1-based start line (default 1)' },
          end_line: { type: 'integer', description: '1-based end line (default start+250)' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with full contents.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' },
          content: { type: 'string', description: 'Full file content' }
        },
        required: ['file_path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact contiguous substring inside an existing file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' },
          old_text: { type: 'string', description: 'Exact text to replace' },
          new_text: { type: 'string', description: 'Replacement text' }
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
          dir_path: { type: 'string', description: 'Directory path (default .)' },
          max_depth: { type: 'integer', description: 'Max recursion depth (default 3)' }
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
          pattern: { type: 'string', description: 'Regex or text pattern' },
          dir_path: { type: 'string', description: 'Optional directory to search' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load a specialized Q-Branch SKILL.md playbook by name from the skills vault.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill folder name (or "list" to list all skills)' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jev_judge',
      description: 'Run a fast zero-output-token System-1 binary risk or yes/no judgment check via Jev (/v1/systemone).',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Short yes/no judgment question' }
        },
        required: ['question']
      }
    }
  }
];

async function executeTool(name, rawArgs, cfg) {
  let args = {};
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {});
  } catch (e) {
    return `Error parsing tool arguments: ${e.message}`;
  }

  if (name === 'list_dir') {
    const dir = resolveWorkspacePath(args.dir_path || '.');
    const items = walkTree(dir, 0, Math.min(Number(args.max_depth) || 3, 5), []);
    return items.length ? items.join('\n') : '(empty directory)';
  }

  if (name === 'search_text') {
    return searchFilesText(args.pattern || '', args.dir_path || '.');
  }

  if (name === 'read_file') {
    const p = resolveWorkspacePath(args.file_path);
    if (!fs.existsSync(p)) return `File not found: ${p}`;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    const start = Math.max(1, Number(args.start_line) || 1);
    const end = Math.min(lines.length, Number(args.end_line) || (start + 249));
    return lines
      .slice(start - 1, end)
      .map((l, idx) => `${start + idx}: ${l}`)
      .join('\n')
      .slice(0, 24000);
  }

  if (name === 'write_file') {
    const p = resolveWorkspacePath(args.file_path);
    const ok = await confirmAction(`write_file -> ${p} (${String(args.content || '').length} bytes)`);
    if (!ok) return 'Action declined by user.';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(args.content ?? ''), 'utf8');
    return `Wrote ${p} successfully.`;
  }

  if (name === 'edit_file') {
    const p = resolveWorkspacePath(args.file_path);
    if (!fs.existsSync(p)) return `File not found: ${p}`;
    const current = fs.readFileSync(p, 'utf8');
    if (!current.includes(args.old_text)) return `Target text not found in ${p}.`;
    const ok = await confirmAction(`edit_file -> ${p}`);
    if (!ok) return 'Action declined by user.';
    fs.writeFileSync(p, current.replace(args.old_text, args.new_text ?? ''), 'utf8');
    return `Updated ${p} successfully.`;
  }

  if (name === 'run_shell') {
    const cmd = String(args.command || '').trim();
    const cwd = resolveWorkspacePath(args.cwd || '.');
    const ok = await confirmAction(`run_shell: ${cmd}`);
    if (!ok) return 'Command declined by user.';
    try {
      const out = execSync(cmd, {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return (out || '(exit 0, no output)').slice(0, 12000);
    } catch (e) {
      const combined = `${e.stdout || ''}\n${e.stderr || ''}\nExit status: ${e.status ?? 1}`.trim();
      return combined.slice(0, 12000);
    }
  }

  if (name === 'load_skill') {
    const skills = listAvailableSkills();
    if (!args.name || args.name === 'list') {
      return `Available Q-Branch skills (${skills.size}): ${[...skills.keys()].sort().join(', ')}`;
    }
    const p = skills.get(args.name);
    if (!p) return `Skill "${args.name}" not found. Available: ${[...skills.keys()].sort().join(', ')}`;
    return fs.readFileSync(p, 'utf8').slice(0, 16000);
  }

  if (name === 'jev_judge') {
    try {
      const res = await fetch(`${cfg.baseOrigin}/v1/systemone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'jev-latest',
          state: String(args.state || args.question || ''),
          questions: {
            judgment: { type: 'noul', instructions: String(args.question || 'Evaluate this statement.') }
          }
        }),
        signal: AbortSignal.timeout(8000)
      });
      const text = await res.text();
      return `Jev /v1/systemone (HTTP ${res.status}): ${text.slice(0, 800)}`;
    } catch (e) {
      return `Jev request error: ${e.message}`;
    }
  }

  return `Unknown tool: ${name}`;
}

async function callModel(cfg, activeModel, messages) {
  const res = await fetch(`${cfg.baseOrigin}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: activeModel,
      messages,
      tools: TOOL_DEFS,
      tool_choice: 'auto'
    }),
    signal: AbortSignal.timeout(120000)
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500);
    throw new Error(`Gateway HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new Error('Empty model response');
  return choice.message;
}

function saveSessionTranscript(messages) {
  const dir = process.env.QBRANCH_MAC_HOME
    ? path.join(process.env.QBRANCH_MAC_HOME, 'sessions')
    : path.join(os.tmpdir(), 'qbranch-sessions');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(dir, `session-${stamp}.md`);
  const md = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `## ${m.role.toUpperCase()}\n\n${m.content || '(tool calls)'}\n`)
    .join('\n---\n\n');
  fs.writeFileSync(outPath, md, 'utf8');
  return outPath;
}

async function runTurn(cfg, activeModel, messages, userText) {
  messages.push({ role: 'user', content: userText });

  for (let step = 0; step < 20; step++) {
    process.stdout.write(`${C.gray}[*] Thinking (${activeModel})...${C.reset}\r`);
    let msg;
    try {
      msg = await callModel(cfg, activeModel, messages);
    } catch (e) {
      process.stdout.write(' '.repeat(60) + '\r');
      console.log(`${C.red}✗ ${e.message}${C.reset}`);
      return;
    }
    process.stdout.write(' '.repeat(60) + '\r');

    messages.push(msg);

    if (msg.content && msg.content.trim()) {
      console.log(`\n${C.cyan}Q-Branch >${C.reset}\n${msg.content.trim()}\n`);
    }

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const fnName = tc?.function?.name || 'unknown';
      const argPreview = String(tc?.function?.arguments || '').slice(0, 90);
      console.log(`  ${C.magenta}⚡ tool:${C.reset} ${C.white}${fnName}${C.reset} ${C.gray}${argPreview}${C.reset}`);
      const result = await executeTool(fnName, tc?.function?.arguments, cfg);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: String(result)
      });
    }
  }
}

async function main() {
  const cfg = loadConfig();
  let activeModel = cfg.primaryModel;
  const skills = listAvailableSkills();

  if (!cfg.apiKey) {
    console.log(`${C.red}✗ No API key found in settings. Run [S] Gateway Settings first.${C.reset}`);
    process.exit(1);
  }

  const systemPrompt = [
    `You are the 007 Q-Branch Direct Autonomous Coding Agent running natively on ${process.platform} (${os.arch()}).`,
    `Current working directory: ${process.cwd()}`,
    `You have real local tools: run_shell, read_file, write_file, edit_file, list_dir, search_text, load_skill, and jev_judge.`,
    `Available Q-Branch skills (${skills.size}): ${[...skills.keys()].sort().slice(0, 30).join(', ')}. Use load_skill when a task matches one.`,
    `Keep answers clear, concise, and practical. Verify edits before finishing.`
  ].join('\n');

  const messages = [{ role: 'system', content: systemPrompt }];

  if (oneShotPrompt) {
    await runTurn(cfg, activeModel, messages, oneShotPrompt);
    return;
  }

  console.clear();
  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : DIRECT AGENT (ZERO-DEPENDENCY CATALINA-PROOF EDITION)${C.reset}     ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Platform / Node  :${C.reset} ${C.white}${process.platform} (${os.arch()}) | Node ${process.version}${C.reset}`);
  console.log(`  ${C.gray}Working Folder   :${C.reset} ${C.cyan}${process.cwd()}${C.reset}`);
  console.log(`  ${C.gray}Active Model     :${C.reset} ${C.gold}${activeModel}${C.reset} ${C.gray}(Fast: ${cfg.fastModel})${C.reset}`);
  console.log(`  ${C.gray}Skills Available :${C.reset} ${C.green}${skills.size} loaded${C.reset} ${C.gray}| Approval Mode: ${yoloMode ? 'YOLO (Auto)' : 'Interactive'}${C.reset}`);
  console.log(`  ${C.gray}Slash Commands   :${C.reset} ${C.white}/help  /model  /fast  /skills  /skill <name>  /yolo  /cd  /save  /exit${C.reset}`);
  console.log(`${C.cyan}────────────────────────────────────────────────────────────────────────────${C.reset}\n`);

  while (true) {
    const input = (await ask(`${C.green}007 > ${C.reset}`)).trim();
    if (!input) {
      if (process.stdin.readableEnded) break;
      continue;
    }

    if (input === '/exit' || input === '/quit' || input === 'exit' || input === 'quit') break;
    if (input === '/help') {
      console.log(`  ${C.cyan}/model <id>${C.reset}   Switch model (current: ${activeModel})`);
      console.log(`  ${C.cyan}/fast${C.reset}         Toggle between Primary (${cfg.primaryModel}) and Fast (${cfg.fastModel})`);
      console.log(`  ${C.cyan}/skills${C.reset}       List all ${skills.size} available Q-Branch skills`);
      console.log(`  ${C.cyan}/skill <name>${C.reset} Load a skill playbook into context`);
      console.log(`  ${C.cyan}/yolo${C.reset}         Toggle auto-approve for shell & file edits (currently ${yoloMode ? 'ON' : 'OFF'})`);
      console.log(`  ${C.cyan}/cd <path>${C.reset}    Change working folder`);
      console.log(`  ${C.cyan}/clear${C.reset}        Reset conversation history`);
      console.log(`  ${C.cyan}/save${C.reset}         Save chat transcript to Markdown`);
      console.log(`  ${C.cyan}/exit${C.reset}         Return to Q-Branch Hub\n`);
      continue;
    }
    if (input.startsWith('/model')) {
      const m = input.slice(6).trim();
      if (m) {
        activeModel = m;
        console.log(`${C.green}✓ Switched model to ${activeModel}${C.reset}\n`);
      } else {
        console.log(`${C.gold}Active model:${C.reset} ${activeModel} (Primary: ${cfg.primaryModel}, Fast: ${cfg.fastModel})\n`);
      }
      continue;
    }
    if (input === '/fast') {
      activeModel = activeModel === cfg.fastModel ? cfg.primaryModel : cfg.fastModel;
      console.log(`${C.green}✓ Active model now: ${activeModel}${C.reset}\n`);
      continue;
    }
    if (input === '/yolo') {
      yoloMode = !yoloMode;
      console.log(`${C.gold}✓ YOLO auto-approve: ${yoloMode ? 'ON' : 'OFF'}${C.reset}\n`);
      continue;
    }
    if (input === '/skills') {
      console.log(`${C.cyan}Skills (${skills.size}):${C.reset} ${[...skills.keys()].sort().join(', ')}\n`);
      continue;
    }
    if (input.startsWith('/skill ')) {
      const name = input.slice(7).trim();
      const p = skills.get(name);
      if (!p) {
        console.log(`${C.red}✗ Skill "${name}" not found.${C.reset}\n`);
      } else {
        const content = fs.readFileSync(p, 'utf8').slice(0, 16000);
        messages.push({ role: 'system', content: `Active Skill (${name}):\n${content}` });
        console.log(`${C.green}✓ Loaded skill "${name}" into context.${C.reset}\n`);
      }
      continue;
    }
    if (input.startsWith('/cd ')) {
      const dir = resolveWorkspacePath(input.slice(4).trim());
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        process.chdir(dir);
        console.log(`${C.green}✓ Working folder: ${process.cwd()}${C.reset}\n`);
      } else {
        console.log(`${C.red}✗ Folder not found: ${dir}${C.reset}\n`);
      }
      continue;
    }
    if (input === '/clear') {
      messages.splice(1);
      console.log(`${C.green}✓ Conversation cleared.${C.reset}\n`);
      continue;
    }
    if (input === '/save') {
      const saved = saveSessionTranscript(messages);
      console.log(`${C.green}✓ Session saved to ${saved}${C.reset}\n`);
      continue;
    }

    await runTurn(cfg, activeModel, messages, input);
  }
}

try {
  await main();
} finally {
  if (rl) {
    try { rl.close(); } catch (e) {}
  }
}
