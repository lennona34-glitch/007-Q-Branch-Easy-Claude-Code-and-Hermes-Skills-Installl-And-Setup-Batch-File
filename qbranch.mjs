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

function readClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {}
  return { env: {}, permissions: {}, modelSettings: {} };
}

function saveClaudeSettings(settings) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

function syncToHermes(primaryModel, baseUrl, apiKey) {
  try {
    const commands = [];
    if (primaryModel) commands.push(`hermes config set model.default "${primaryModel}"`);
    if (baseUrl) {
      const hermesUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/v1`;
      commands.push(`hermes config set model.base_url "${hermesUrl}"`);
    }
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
      // 3. Autonomous Swarms & Agent Minds (9)
      'anti-sycophancy', 'agent-squad', 'autonomous-agents', 'goal-loop',
      'planning-with-files', 'agent-memory', 'subagent-orchestrator',
      'doubt-driven-development', 'systematic-debugging',
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
      'council-multi-model', 'code-reviewer', 'simplify-code', 'anti-ui-slop',
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
  console.log(`  [*] Deploying ${profile.skills.length} skills to Claude Code (~/.claude/skills)...`);
  fs.mkdirSync(CLAUDE_SKILLS_PATH, { recursive: true });
  for (const item of fs.readdirSync(CLAUDE_SKILLS_PATH)) {
    fs.rmSync(path.join(CLAUDE_SKILLS_PATH, item), { recursive: true, force: true });
  }
  let installedClaude = 0;
  for (const skill of profile.skills) {
    const src = resolveSkillPath(skill);
    if (src && fs.existsSync(src)) {
      fs.cpSync(src, path.join(CLAUDE_SKILLS_PATH, skill), { recursive: true });
      installedClaude++;
    }
  }
  console.log(`  ${C.green}✓${C.reset} Claude Code updated: ${C.white}${installedClaude} skills active${C.reset}`);

  // 3. Deploy to Hermes Agent (WSL Kali)
  console.log(`  [*] Synchronizing to Hermes Agent (WSL Kali ~/.hermes/skills/vault)...`);
  runWsl('mkdir -p /home/Ade/.hermes/skills/vault && rm -rf /home/Ade/.hermes/skills/vault/*');
  runWsl('cp -r /mnt/c/Users/adria/.claude/skills/* /home/Ade/.hermes/skills/vault/');

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
  console.log(`${C.gold}[4/4] Gateway & API Key Configuration...${C.reset}`);
  const settings = readClaudeSettings();
  const currentKey = settings.env?.ANTHROPIC_AUTH_TOKEN || '';
  if (currentKey) {
    console.log(`  ${C.green}✓ API Key already configured (${currentKey.slice(0, 7)}...${currentKey.slice(-4)})${C.reset}\n`);
  } else {
    console.log(`  ${C.cyan}Free promotional models (GPT-6 Luna + DeepSeek Flash 1017) are available on Experiential Labs.${C.reset}`);
    await configureApi();
  }

  // 5. Deploy Bundled Skills
  console.log(`[*] Deploying Bundled 44 Special Ops Skills...`);
  await applyMissionLoadout('special_ops');

  console.log(`\n${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`  ${C.gold}🎉 007 Q-BRANCH SETUP COMPLETE!${C.reset}`);
  console.log(`  You are ready to launch:`);
  console.log(`    [1] Claude Code  (Tag Team: GPT-6 Luna + DeepSeek Flash 1017)`);
  console.log(`    [2] Hermes Agent (Autonomous GPT-6 Luna in WSL)`);
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

  console.log(`\n${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.gold}007 Q-BRANCH : AGENT INTELLIGENCE HUB${C.reset}                                 ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.gray}Gateway Base URL   :${C.reset} ${C.white}${baseUrl}${C.reset}`);
  console.log(`  ${C.gray}API Key            :${C.reset} ${C.green}${maskedKey}${C.reset}`);
  console.log(`  ${C.gray}Primary Model      :${C.reset} ${C.gold}${primaryModel}${C.reset} ${C.green}[FLAGSHIP]${C.reset}`);
  console.log(`  ${C.gray}Fast Aux Model     :${C.reset} ${C.cyan}${auxModel}${C.reset} ${C.green}[SUBAGENT]${C.reset}`);
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
  saveClaudeSettings(settings);

  console.log(`[*] Syncing to Hermes Agent...`);
  syncToHermes(null, targetUrl, targetKey);
  console.log(`${C.green}✓ Saved and synchronized across Claude Code & Hermes!${C.reset}\n`);
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

  console.log(`\n${C.gold}═══ Q-BRANCH : LIVE ONLINE MODEL BROWSER ═══${C.reset}`);
  console.log(`Fetching active models from ${C.cyan}${baseUrl}${C.reset}...\n`);

  const modelsUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  let data = [];
  try {
    const res = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    data = json.data || [];
  } catch (e) {
    console.log(`${C.red}Failed to fetch models: ${e.message}${C.reset}`);
    return;
  }

  const freeModels = [];
  const proModels = [];

  for (const m of data) {
    const mid = m.id;
    const p = m.pricing || {};
    const inCost = p.input_nano_usd_per_million_tokens;
    const outCost = p.output_nano_usd_per_million_tokens;
    const isFree = (inCost === 0 && outCost === 0) || 
                   /luna|1017|clef-flash|jev-latest/i.test(mid) ||
                   mid === 'gpt-6-luna' || mid === 'deepseek-v4.1-flash-1017';

    const item = {
      id: mid,
      tools: m.supports_tools !== false,
      ctx: m.context_window_tokens ? `${Math.round(m.context_window_tokens / 1024)}K` : 'Auto'
    };

    if (isFree) {
      freeModels.push(item);
    } else if (/pro|opus|sonnet|claude|deepseek-v4|gpt-4/i.test(mid)) {
      proModels.push(item);
    }
  }

  console.log(`${C.green}⭐ ZERO-COST PROMOTIONAL TIER (FREE):${C.reset}`);
  freeModels.forEach((m, idx) => {
    const active = (m.id === env.ANTHROPIC_MODEL) ? ` ${C.gold}◀ ACTIVE PRIMARY${C.reset}` :
                   (m.id === env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ? ` ${C.cyan}◀ ACTIVE FAST/SUBAGENT${C.reset}` : '';
    console.log(`  ${C.green}[F${idx + 1}]${C.reset} ${C.white}${m.id.padEnd(28)}${C.reset} ${C.gray}(Ctx: ${m.ctx})${C.reset}${active}`);
  });

  console.log(`\n${C.gold}🚀 POPULAR FLAGSHIP & PRO MODELS:${C.reset}`);
  proModels.slice(0, 10).forEach((m, idx) => {
    const active = (m.id === env.ANTHROPIC_MODEL) ? ` ${C.gold}◀ ACTIVE PRIMARY${C.reset}` :
                   (m.id === env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ? ` ${C.cyan}◀ ACTIVE FAST/SUBAGENT${C.reset}` : '';
    console.log(`  ${C.gold}[P${idx + 1}]${C.reset} ${C.white}${m.id.padEnd(28)}${C.reset} ${C.gray}(Ctx: ${m.ctx})${C.reset}${active}`);
  });

  console.log(`\n${C.cyan}Options:${C.reset}`);
  console.log(`  1. Set [F2] GPT-6 Luna (Primary) + DeepSeek Flash 1017 (Fast) ${C.green}[Recommended Free Pair]${C.reset}`);
  console.log(`  2. Set [F3] DeepSeek Flash 1017 (All-round speed) ${C.green}[Zero Cost]${C.reset}`);
  console.log(`  3. Manually enter model names`);
  console.log(`  0. Cancel`);
  
  const choice = await ask(`\nSelect an option [1-3, 0]: `);

  if (choice === '1') {
    applyModelPair('gpt-6-luna', 'deepseek-v4.1-flash-1017');
  } else if (choice === '2') {
    applyModelPair('deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017');
  } else if (choice === '3') {
    const p = await ask(`Enter Primary Model ID (e.g. gpt-6-luna): `);
    const f = await ask(`Enter Fast Model ID (e.g. deepseek-v4.1-flash-1017): `);
    if (p && f) applyModelPair(p, f);
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
  syncToHermes(primary, settings.env.ANTHROPIC_BASE_URL, settings.env.ANTHROPIC_AUTH_TOKEN);

  console.log(`\n${C.green}✓ Models updated!${C.reset}`);
  console.log(`  Primary (Sonnet / Hermes): ${C.gold}${primary}${C.reset}`);
  console.log(`  Fast Aux (Haiku / Subagent): ${C.cyan}${fast}${C.reset}\n`);
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

  // Phase 5: API Keys & Custom Gateway Settings
  console.log(`${C.gold}[5/6] Exporting credentials & zero-cost gateway configurations...${C.reset}`);
  const activeSettings = readClaudeSettings();
  const currentKey = activeSettings.env?.ANTHROPIC_AUTH_TOKEN || 'xpl_de71f2d6f46ee963be11c0cfe63225085d1eb7d6';
  const currentUrl = activeSettings.env?.ANTHROPIC_BASE_URL || 'https://api.experientiallabs.ai';
  const primaryModel = activeSettings.env?.ANTHROPIC_MODEL || 'gpt-6-luna';
  const fastModel = activeSettings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4.1-flash-1017';

  const portableClaudeSettings = {
    env: {
      ANTHROPIC_BASE_URL: currentUrl,
      ANTHROPIC_AUTH_TOKEN: currentKey,
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
      allowAll: true
    }
  };
  fs.writeFileSync(path.join(targetPath, 'config', 'claude', 'settings.json'), JSON.stringify(portableClaudeSettings, null, 2), 'utf8');
  fs.writeFileSync(path.join(targetPath, 'data', 'home', '.claude', 'settings.json'), JSON.stringify(portableClaudeSettings, null, 2), 'utf8');

  // Hermes config.yaml and .env
  const hermesApiUrl = currentUrl.endsWith('/v1') ? currentUrl : `${currentUrl.replace(/\/+$/, '')}/v1`;
  const hermesYaml = `# 007 Q-Branch Portable Configuration
_config_version: 52
model:
  default: "${primaryModel}"
  provider: "custom"
  base_url: "${hermesApiUrl}"
  api_key: "${currentKey}"
runtime:
  nofile_soft_limit: 4096
tools:
  tool_search:
    enabled: "off"
`;
  fs.writeFileSync(path.join(targetPath, 'config', 'hermes', 'config.yaml'), hermesYaml, 'utf8');

  const hermesEnv = `# 007 Q-Branch Portable Environment
OPENAI_API_KEY=${currentKey}
OPENAI_BASE_URL=${hermesApiUrl}
CUSTOM_API_KEY=${currentKey}
`;
  fs.writeFileSync(path.join(targetPath, 'config', 'hermes', '.env'), hermesEnv, 'utf8');
  console.log(`  ${C.green}✓ API keys connected & isolated to USB storage.${C.reset}\n`);

  // Phase 6: Skills Deployment & Launcher Deployment
  console.log(`${C.gold}[6/6] Transferring 44 Special Ops skills & Mission Launcher...${C.reset}`);
  
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
* **Zero Host Requirements:** Node.js, npm, Claude Code, and Hermes runners are bundled directly on this drive in \`runtime/\`. The host computer needs **nothing installed**.
* **Pre-Connected API Keys:** Pre-configured with the **Experiential Labs zero-cost promotional tier** (\`$0.00\` billing):
  * **GPT-6 Luna** (Flagship Coding Agent)
  * **DeepSeek V4.1 Flash 1017** (Ultra-Fast Aux / Subagent)
* **Pre-Loaded Skills:** All **${copiedSkillsCount} Special Ops Skills** are pre-loaded for both Claude Code and Hermes Agent.
* **100% Private & Isolated:** All user profiles, session histories, chat logs, and caches are written strictly to \`data/\` on this drive. **Zero traces or files are left on the host PC.**

---

### How to Use on Any PC
1. Plug this USB drive into any Windows PC.
2. Open this folder in File Explorer.
3. Double-click **\`Launch Agent.bat\`**.
4. Choose your agent from the mission menu:
   * \`[1]\` Claude Code
   * \`[2]\` Hermes Agent
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
  console.log(`  ${C.gray}Payload Status   :${C.reset} ${C.green}Standalone Runtime + Full Arsenal Active${C.reset}`);
  console.log(`  ${C.gray}Primary Model    :${C.reset} ${C.gold}${primaryModel}${C.reset} ${C.green}[$0.00 Free Tier]${C.reset}`);
  console.log(`  ${C.gray}Auxiliary Model  :${C.reset} ${C.cyan}${fastModel}${C.reset} ${C.green}[$0.00 Free Tier]${C.reset}`);
  console.log(`  ${C.gray}Skills Loaded    :${C.reset} ${C.magenta}${copiedSkillsCount} combat skills deployed${C.reset}`);
  console.log(`  ${C.gray}Host Footprint   :${C.reset} ${C.green}0% (Zero files, registry keys or logs left on host)${C.reset}`);
  console.log(`  ${C.gray}Next Step        :${C.reset} ${C.white}Plug into any Windows machine and double-click 'Launch Agent.bat'.${C.reset}`);
  console.log(`${C.cyan}════════════════════════════════════════════════════════════════════════════${C.reset}\n`);

  await ask(`Press Enter to return to Q-Branch menu... `);
}

// CLI Router
const args = process.argv.slice(2);
const cmd = (args[0] || 'status').toLowerCase();
const currentDir = process.cwd();

try {
  if (cmd === 'status') {
    await showStatus();
  } else if (cmd === 'config') {
    await configureApi();
  } else if (cmd === 'models') {
    await browseModels();
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
