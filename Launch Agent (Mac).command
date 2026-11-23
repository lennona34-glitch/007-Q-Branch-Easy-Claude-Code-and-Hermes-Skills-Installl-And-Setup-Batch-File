#!/usr/bin/env bash
# ==============================================================================
# 007 Q-BRANCH : SMART MACOS AGENT COMMAND CENTER (Intel & Apple Silicon)
# Compatible with macOS 10.15 Catalina (Bash 3.2) through macOS 15+ Sequoia
# Handles Read-Only NTFS USB drives automatically via ~/Q-Branch-Mac mirror.
# ==============================================================================

set -u

# ANSI Colors
C_RESET=$'\033[0m'
C_BOLD=$'\033[1m'
C_CYAN=$'\033[1;36m'
C_GOLD=$'\033[1;33m'
C_GREEN=$'\033[1;32m'
C_RED=$'\033[1;31m'
C_MAGENTA=$'\033[1;35m'
C_WHITE=$'\033[1;37m'
C_GRAY=$'\033[90m'

printf '\033]0;Q-BRANCH AGENT HUB (macOS 007 Edition)\007'

# ------------------------------------------------------------------------------
# 1. Detect Hardware, macOS Version & USB Volume
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_VER="$(sw_vers -productVersion 2>/dev/null || echo '10.15.0')"
MAC_ARCH="$(uname -m 2>/dev/null || echo 'x86_64')"
MAC_MAJOR="$(echo "$MAC_VER" | awk -F. '{print $1+0}')"
MAC_MINOR="$(echo "$MAC_VER" | awk -F. '{print $2+0}')"

CAN_CLAUDE=0
if [ "$MAC_MAJOR" -ge 13 ]; then
  CAN_CLAUDE=1
fi

MAC_HOME="$HOME/Q-Branch-Mac"
WORK_DIR="$HOME"
if [ -n "${1:-}" ] && [ -d "${1:-}" ]; then
  WORK_DIR="$(cd "$1" && pwd)"
fi

# Locate Q-Branch-Portable on USB (either script location or /Volumes/*)
USB_ROOT=""
USB_MODE="OFFLINE LOCAL MIRROR"
if [ -f "$SCRIPT_DIR/qbranch.mjs" ] && [ -d "$SCRIPT_DIR/config/claude" ] && [ "$SCRIPT_DIR" != "$MAC_HOME" ]; then
  USB_ROOT="$SCRIPT_DIR"
else
  for vol in /Volumes/*; do
    [ -d "$vol" ] || continue
    if [ -f "$vol/Q-Branch-Portable/qbranch.mjs" ]; then
      USB_ROOT="$vol/Q-Branch-Portable"
      break
    elif [ -f "$vol/007-Q-Branch/qbranch.mjs" ]; then
      USB_ROOT="$vol/007-Q-Branch"
      break
    elif [ -f "$vol/qbranch.mjs" ] && [ -d "$vol/config/claude" ]; then
      USB_ROOT="$vol"
      break
    fi
  done
fi

if [ -n "$USB_ROOT" ]; then
  if [ -w "$USB_ROOT" ]; then
    USB_MODE="USB READ/WRITE ($USB_ROOT)"
  else
    USB_MODE="USB NTFS READ-ONLY -> MIRRORED TO ~/Q-Branch-Mac"
  fi
fi

# ------------------------------------------------------------------------------
# 2. Bootstrap ~/Q-Branch-Mac Runtime & Sync from USB
# ------------------------------------------------------------------------------
mkdir -p "$MAC_HOME/runtime/node" \
         "$MAC_HOME/runtime/jev-use" \
         "$MAC_HOME/config/claude/skills" \
         "$MAC_HOME/config/hermes/skills/vault" \
         "$MAC_HOME/skills" \
         "$MAC_HOME/sessions"

install_node_runtime() {
  if [ -x "$MAC_HOME/runtime/node/bin/node" ]; then
    if "$MAC_HOME/runtime/node/bin/node" -v >/dev/null 2>&1; then
      return 0
    fi
  fi

  echo "${C_GOLD}[*] Setting up Catalina-compatible Node.js 20 runtime in ~/Q-Branch-Mac/runtime/node...${C_RESET}"
  NODE_ARCH="x64"
  if [ "$MAC_ARCH" = "arm64" ]; then
    NODE_ARCH="arm64"
  fi

  TAR_SRC=""
  if [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/runtime/mac/node-darwin-${NODE_ARCH}.tar.gz" ]; then
    TAR_SRC="$USB_ROOT/runtime/mac/node-darwin-${NODE_ARCH}.tar.gz"
    echo "${C_GREEN}  [+] Found pre-bundled Node.js tarball on USB! Extracting to SSD...${C_RESET}"
  elif [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/runtime/mac/node-darwin-x64.tar.gz" ]; then
    TAR_SRC="$USB_ROOT/runtime/mac/node-darwin-x64.tar.gz"
    echo "${C_GREEN}  [+] Found pre-bundled Intel x64 Node.js tarball on USB! Extracting...${C_RESET}"
  else
    TAR_SRC="/tmp/qbranch-node-v20.20.2-darwin-${NODE_ARCH}.tar.gz"
    NODE_URL="https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-${NODE_ARCH}.tar.gz"
    echo "${C_CYAN}  [*] Downloading Node.js v20.20.2 (${NODE_ARCH}) from nodejs.org...${C_RESET}"
    curl -fL "$NODE_URL" -o "$TAR_SRC" || {
      echo "${C_RED}  [!] Failed to download Node.js. Check internet connection or bundle tarball on USB.${C_RESET}"
      return 1
    }
  fi

  rm -rf "$MAC_HOME/runtime/node"
  mkdir -p "$MAC_HOME/runtime/node"
  tar -xzf "$TAR_SRC" -C "$MAC_HOME/runtime/node" --strip-components=1 || return 1
  chmod +x "$MAC_HOME/runtime/node/bin/"* 2>/dev/null || true
  xattr -dr com.apple.quarantine "$MAC_HOME/runtime/node" 2>/dev/null || true

  if "$MAC_HOME/runtime/node/bin/node" -v >/dev/null 2>&1; then
    echo "${C_GREEN}  [+] Node.js ready: $("$MAC_HOME/runtime/node/bin/node" -v)${C_RESET}"
    return 0
  fi
  echo "${C_RED}  [!] Node binary failed self-check on macOS ${MAC_VER}.${C_RESET}"
  return 1
}

rewrite_mac_paths() {
  local node_bin="$MAC_HOME/runtime/node/bin/node"
  [ -x "$node_bin" ] || return 0
  "$node_bin" -e '
    const fs = require("fs");
    const path = require("path");
    const macHome = process.env.QBRANCH_MAC_HOME;
    const nodeBin = path.join(macHome, "runtime", "node", "bin", "node");
    const jevCli = path.join(macHome, "runtime", "jev-use", "node_modules", "jev-use", "dist", "cli.js");
    const hasJev = fs.existsSync(jevCli);

    const sPath = path.join(macHome, "config", "claude", "settings.json");
    let settings = { env: {}, permissions: {} };
    if (fs.existsSync(sPath)) {
      try { settings = JSON.parse(fs.readFileSync(sPath, "utf8")); } catch (e) {}
    }
    settings.env = settings.env || {};
    const apiKey = settings.env.TYPESAFE_API_KEY || settings.env.ANTHROPIC_AUTH_TOKEN || "";
    const rawBase = settings.env.TYPESAFE_BASE_URL || settings.env.ANTHROPIC_BASE_URL || "https://api.experientiallabs.ai";
    const baseOrigin = rawBase.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    const primary = settings.env.ANTHROPIC_MODEL || "gpt-6-luna";
    const fast = settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "deepseek-v4.1-flash-1017";
    if (apiKey) settings.env.TYPESAFE_API_KEY = apiKey;
    settings.env.TYPESAFE_BASE_URL = baseOrigin;
    fs.mkdirSync(path.dirname(sPath), { recursive: true });
    fs.writeFileSync(sPath, JSON.stringify(settings, null, 2), "utf8");

    const cjPath = path.join(macHome, "config", "claude", ".claude.json");
    let cj = {};
    if (fs.existsSync(cjPath)) {
      try { cj = JSON.parse(fs.readFileSync(cjPath, "utf8")); } catch (e) {}
    }
    cj.mcpServers = cj.mcpServers || {};
    cj.mcpServers.jev = {
      type: "stdio",
      command: hasJev ? nodeBin : "npx",
      args: hasJev ? [jevCli, "serve"] : ["-y", "jev-use@0.8.0", "serve"],
      env: { TYPESAFE_API_KEY: apiKey, TYPESAFE_BASE_URL: baseOrigin }
    };
    fs.writeFileSync(cjPath, JSON.stringify(cj, null, 2), "utf8");

    const hDir = path.join(macHome, "config", "hermes");
    fs.mkdirSync(hDir, { recursive: true });
    const hCfgPath = path.join(hDir, "config.yaml");
    let reasoning = "none";
    if (fs.existsSync(hCfgPath)) {
      const oldRaw = fs.readFileSync(hCfgPath, "utf8");
      const rm = oldRaw.match(/reasoning_effort:\s*"([^"]+)"/);
      if (rm) reasoning = rm[1];
    }
    const hermesYaml = [
      "# 007 Q-Branch macOS Configuration",
      "_config_version: 53",
      "model:",
      `  default: "${primary}"`,
      `  provider: "custom"`,
      `  base_url: "${baseOrigin}/v1"`,
      `  api_key: "${apiKey}"`,
      "agent:",
      `  reasoning_effort: "${reasoning}"`,
      "delegation:",
      `  model: "${fast}"`,
      "  max_iterations: 250",
      "mcp_servers:",
      "  jev:",
      `    command: "${hasJev ? nodeBin : "npx"}"`,
      `    args: ${hasJev ? JSON.stringify([jevCli, "serve"]) : JSON.stringify(["-y", "jev-use@0.8.0", "serve"])}`,
      "    env:",
      `      TYPESAFE_API_KEY: "${apiKey}"`,
      `      TYPESAFE_BASE_URL: "${baseOrigin}"`,
      "runtime:",
      "  nofile_soft_limit: 4096",
      "tools:",
      "  tool_search:",
      `    enabled: "off"`,
      ""
    ].join("\n");
    fs.writeFileSync(hCfgPath, hermesYaml, "utf8");

    const hermesEnv = [
      "# 007 Q-Branch macOS Environment",
      `OPENAI_API_KEY=${apiKey}`,
      `OPENAI_BASE_URL=${baseOrigin}/v1`,
      `CUSTOM_API_KEY=${apiKey}`,
      `TYPESAFE_API_KEY=${apiKey}`,
      `TYPESAFE_BASE_URL=${baseOrigin}`,
      ""
    ].join("\n");
    fs.writeFileSync(path.join(hDir, ".env"), hermesEnv, "utf8");
  ' 2>/dev/null || true
}

sync_from_usb() {
  local force_cfg="${1:-0}"
  [ -n "$USB_ROOT" ] || return 0
  [ -d "$USB_ROOT" ] || return 0

  echo "${C_CYAN}[*] Syncing scripts, skills & configs from USB -> ~/Q-Branch-Mac...${C_RESET}"
  [ -f "$USB_ROOT/qbranch.mjs" ] && cp -f "$USB_ROOT/qbranch.mjs" "$MAC_HOME/qbranch.mjs"
  [ -f "$USB_ROOT/qbranch-agent.mjs" ] && cp -f "$USB_ROOT/qbranch-agent.mjs" "$MAC_HOME/qbranch-agent.mjs"
  [ -f "$USB_ROOT/Launch Agent (Mac).command" ] && cp -f "$USB_ROOT/Launch Agent (Mac).command" "$MAC_HOME/Launch Agent (Mac).command" && chmod +x "$MAC_HOME/Launch Agent (Mac).command" 2>/dev/null || true

  if [ -d "$USB_ROOT/runtime/jev-use/node_modules" ] && [ ! -f "$MAC_HOME/runtime/jev-use/node_modules/jev-use/dist/cli.js" ]; then
    cp -R "$USB_ROOT/runtime/jev-use/." "$MAC_HOME/runtime/jev-use/" 2>/dev/null || true
  fi

  if [ -d "$USB_ROOT/skills" ]; then
    if [ "$force_cfg" = "1" ] || [ -z "$(ls -A "$MAC_HOME/skills" 2>/dev/null)" ]; then
      cp -R "$USB_ROOT/skills/." "$MAC_HOME/skills/" 2>/dev/null || true
      cp -R "$USB_ROOT/skills/." "$MAC_HOME/config/claude/skills/" 2>/dev/null || true
      cp -R "$USB_ROOT/skills/." "$MAC_HOME/config/hermes/skills/vault/" 2>/dev/null || true
    fi
  fi

  if [ "$force_cfg" = "1" ] || [ ! -f "$MAC_HOME/config/claude/settings.json" ]; then
    if [ -f "$USB_ROOT/config/claude/settings.json" ]; then
      cp -f "$USB_ROOT/config/claude/settings.json" "$MAC_HOME/config/claude/settings.json"
    fi
  fi

  rewrite_mac_paths
}

install_desktop_shortcut() {
  local shortcut="$HOME/Desktop/Q-Branch Agent.command"
  if [ -d "$HOME/Desktop" ] && [ ! -f "$shortcut" ]; then
    cat > "$shortcut" <<'EOF'
#!/usr/bin/env bash
for vol in /Volumes/*; do
  if [ -f "$vol/Q-Branch-Portable/Launch Agent (Mac).command" ]; then
    exec bash "$vol/Q-Branch-Portable/Launch Agent (Mac).command" "$@"
  fi
done
if [ -f "$HOME/Q-Branch-Mac/Launch Agent (Mac).command" ]; then
  exec bash "$HOME/Q-Branch-Mac/Launch Agent (Mac).command" "$@"
fi
echo "Q-Branch USB not found and ~/Q-Branch-Mac not initialized."
read -r -p "Press Enter to close..." _
EOF
    chmod +x "$shortcut" 2>/dev/null || true
    echo "${C_GREEN}[+] Created clickable Mac Desktop shortcut: ~/Desktop/Q-Branch Agent.command${C_RESET}"
  fi
}

export QBRANCH_MAC_HOME="$MAC_HOME"
export QBRANCH_PORTABLE="1"
export CLAUDE_CONFIG_DIR="$MAC_HOME/config/claude"
export HERMES_HOME="$MAC_HOME/config/hermes"
export USB_ROOT="$USB_ROOT"
export CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT="1"
export CLAUDE_CODE_AUTO_MODE_SERVER="0"
export PATH="$MAC_HOME/runtime/node/bin:$HOME/.local/bin:$HOME/.hermes/bin:$PATH"

install_node_runtime
sync_from_usb 0
install_desktop_shortcut

QBRANCH_SCRIPT="$MAC_HOME/qbranch.mjs"
AGENT_SCRIPT="$MAC_HOME/qbranch-agent.mjs"
NODE_BIN="$MAC_HOME/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || echo node)"
fi

find_hermes_bin() {
  if [ -x "$HOME/.local/bin/hermes" ]; then
    echo "$HOME/.local/bin/hermes"
  elif [ -x "$HOME/.hermes/bin/hermes" ]; then
    echo "$HOME/.hermes/bin/hermes"
  elif command -v hermes >/dev/null 2>&1; then
    command -v hermes
  else
    echo ""
  fi
}

install_hermes_mac() {
  echo ""
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "${C_GOLD} 007 Q-BRANCH : INSTALL / REPAIR HERMES AGENT ON MACOS ${MAC_VER} (${MAC_ARCH})${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "${C_GRAY}Running official Nous Research Hermes installer (Python 3.14 standalone)...${C_RESET}"
  echo "${C_GRAY}Note: If any compiled wheel rejects macOS ${MAC_VER}, [3] Q-Branch Direct Agent${C_RESET}"
  echo "${C_GRAY}      is always available right away with zero external dependencies.${C_RESET}"
  echo ""
  export MACOSX_DEPLOYMENT_TARGET="${MAC_MAJOR}.${MAC_MINOR}"
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  local rc=$?
  rewrite_mac_paths
  if [ "$rc" -eq 0 ] && [ -n "$(find_hermes_bin)" ]; then
    echo ""
    echo "${C_GREEN}[+] Hermes installed! Testing Jev MCP bridge...${C_RESET}"
    "$(find_hermes_bin)" mcp test jev || true
  else
    echo ""
    echo "${C_GOLD}[!] Hermes installer exited with code ${rc}.${C_RESET}"
    echo "${C_WHITE}Tip: You can still use [3] Q-Branch Direct Agent immediately on macOS ${MAC_VER}!${C_RESET}"
  fi
  echo ""
  read -r -p "Press Enter to return to menu..." _
}

run_hermes_with_args() {
  local extra_args="${1:-}"
  local hbin
  hbin="$(find_hermes_bin)"
  if [ -z "$hbin" ]; then
    echo ""
    echo "${C_GOLD}[!] Hermes Agent is not installed on this Mac yet.${C_RESET}"
    read -r -p "Install Hermes now? [Y/n] (or press n to use [3] Direct Agent): " ans
    ans_low="$(echo "${ans:-y}" | tr '[:upper:]' '[:lower:]')"
    if [ "$ans_low" = "y" ] || [ "$ans_low" = "yes" ]; then
      install_hermes_mac
      hbin="$(find_hermes_bin)"
    fi
    [ -z "$hbin" ] && return 0
  fi
  echo ""
  echo "${C_GREEN}[*] Launching Hermes Agent in ${WORK_DIR}...${C_RESET}"
  (cd "$WORK_DIR" && eval "\"$hbin\" $extra_args")
  echo ""
  read -r -p "Mission session concluded. Press Enter to return to Q-Branch..." _
}

pick_folder_mac() {
  clear
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "${C_GOLD}              007 Q-BRANCH : TARGET FOLDER SELECTION (MACOS)                  ${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "  Current Operational Folder : ${C_WHITE}${WORK_DIR}${C_RESET}"
  echo ""
  echo "  ${C_GREEN}[1]${C_RESET} Browse with macOS Finder Dialog (GUI)"
  echo "  ${C_CYAN}[2]${C_RESET} Type / Drag-and-Drop Folder Path"
  echo "  ${C_RED}[0]${C_RESET} Cancel"
  echo ""
  read -r -p "Select option [1-2, 0]: " pchoice
  if [ "$pchoice" = "1" ]; then
    local picked
    picked="$(osascript -e 'POSIX path of (choose folder with prompt "007 Q-Branch: Select Project Folder")' 2>/dev/null || true)"
    if [ -n "$picked" ] && [ -d "$picked" ]; then
      WORK_DIR="${picked%/}"
      echo "${C_GREEN}[+] Folder locked: ${WORK_DIR}${C_RESET}"
      sleep 1
    fi
  elif [ "$pchoice" = "2" ]; then
    read -r -p "Paste or drag folder path: " mpath
    mpath="${mpath%\"}"
    mpath="${mpath#\"}"
    mpath="${mpath%\'}"
    mpath="${mpath#\'}"
    mpath="${mpath/#\~/$HOME}"
    if [ -d "$mpath" ]; then
      WORK_DIR="$(cd "$mpath" && pwd)"
      echo "${C_GREEN}[+] Folder locked: ${WORK_DIR}${C_RESET}"
      sleep 1
    else
      echo "${C_RED}[!] Folder not found: ${mpath}${C_RESET}"
      sleep 2
    fi
  fi
}

# ------------------------------------------------------------------------------
# 3. Main Interactive Menu Loop
# ------------------------------------------------------------------------------
while true; do
  clear

  Q_PRIMARY="gpt-6-luna"
  Q_FAST="deepseek-v4.1-flash-1017"
  Q_JEV_STATUS="CHECKING"
  Q_JEV_GATE="OFF"

  if [ -f "$QBRANCH_SCRIPT" ]; then
    while IFS='=' read -r k v; do
      case "$k" in
        Q_PRIMARY) Q_PRIMARY="$v" ;;
        Q_FAST) Q_FAST="$v" ;;
        Q_JEV_STATUS) Q_JEV_STATUS="$v" ;;
        Q_JEV_GATE) Q_JEV_GATE="$v" ;;
      esac
    done < <("$NODE_BIN" "$QBRANCH_SCRIPT" env-summary 2>/dev/null || true)
  fi

  HERMES_BIN="$(find_hermes_bin)"
  if [ -n "$HERMES_BIN" ]; then
    HERMES_STATUS="${C_GREEN}INSTALLED${C_RESET}"
  else
    HERMES_STATUS="${C_GOLD}NOT INSTALLED (Press [I] to install)${C_RESET}"
  fi

  if [ "$CAN_CLAUDE" -eq 1 ]; then
    CLAUDE_LABEL="${C_GRAY}- Native macOS 13+ supported${C_RESET}"
  else
    CLAUDE_LABEL="${C_GRAY}- Requires macOS 13+ Ventura (Detected ${MAC_VER})${C_RESET}"
  fi

  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "${C_GOLD}      ___   ___  _____     ___        ___   ___    _   _  _  ___  _  _  ${C_RESET}"
  echo "${C_GOLD}     / _ \\ / _ \\|___  |   / _ \\      | _ ) | _ \\  /_\\ | \\| |/ __|| || | ${C_RESET}"
  echo "${C_GOLD}    | (_) | (_) |  / /   | (_) | --- | _ \\ |   / / _ \\| .\` | (__ | __ | ${C_RESET}"
  echo "${C_GOLD}     \\___/ \\___/  /_/     \\__\\_|     |___/ |_|_\\/_/ \\_\\_|\\_|\\___||_||_| ${C_RESET}"
  echo "${C_MAGENTA}             AI AGENT COMMAND CENTER | MACOS PORTABLE EDITION                 ${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "  ${C_GRAY}MAC HARDWARE       :${C_RESET} ${C_WHITE}macOS ${MAC_VER} (${MAC_ARCH}) | Node $("$NODE_BIN" -v 2>/dev/null || echo 'missing')${C_RESET}"
  echo "  ${C_GRAY}STORAGE / SYNC     :${C_RESET} ${C_GREEN}${USB_MODE}${C_RESET}"
  echo "  ${C_GRAY}OPERATIONAL FOLDER :${C_RESET} ${C_WHITE}${WORK_DIR}${C_RESET}"
  echo "  ${C_GRAY}ACTIVE TEAM        :${C_RESET} ${C_GOLD}${Q_PRIMARY}${C_RESET} + ${C_CYAN}${Q_FAST}${C_RESET}"
  echo "  ${C_GRAY}JEV INTERVENTION   :${C_RESET} ${C_GREEN}${Q_JEV_STATUS}${C_RESET} ${C_GRAY}[PreToolUse Gate: ${C_GOLD}${Q_JEV_GATE}${C_GRAY}]${C_RESET}"
  echo "  ${C_GRAY}HERMES ENGINE      :${C_RESET} ${HERMES_STATUS}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo ""
  echo "  ${C_GREEN}[1]${C_RESET} ${C_WHITE}Hermes Agent${C_RESET}            ${C_GRAY}- Synced Split [${Q_PRIMARY} + Subagent ${Q_FAST}]${C_RESET}"
  echo "  ${C_GREEN}[2]${C_RESET} ${C_WHITE}Hermes Agent (TUI)${C_RESET}      ${C_GRAY}- Visual Dashboard Interface [${Q_PRIMARY}]${C_RESET}"
  echo "  ${C_GREEN}[3]${C_RESET} ${C_WHITE}Q-Branch Direct Agent${C_RESET}   ${C_GOLD}[Catalina-Proof]${C_GRAY} Zero-install coding agent + tools${C_RESET}"
  echo "  ${C_GOLD}[4]${C_RESET} ${C_WHITE}Q-Branch Direct (YOLO)${C_RESET}  ${C_GRAY}- Auto-approve shell & file edits${C_RESET}"
  echo "  ${C_GOLD}[5]${C_RESET} ${C_WHITE}Hermes Agent (YOLO)${C_RESET}     ${C_GRAY}- Auto-approve Hermes commands${C_RESET}"
  echo "  ${C_GRAY}[6] Claude Code${C_RESET}             ${CLAUDE_LABEL}"
  echo ""
  echo "  ${C_CYAN}--- Q-BRANCH ARSENAL & MAC TOOLS ---${C_RESET}"
  echo "  ${C_CYAN}[W]${C_RESET} ${C_WHITE}Select Project Folder${C_RESET}   ${C_GRAY}- Native macOS Finder Picker (or drag path)${C_RESET}"
  echo "  ${C_CYAN}[I]${C_RESET} ${C_WHITE}Install/Repair Hermes${C_RESET}   ${C_GRAY}- Setup Hermes Agent + Jev MCP on this Mac${C_RESET}"
  echo "  ${C_MAGENTA}[P]${C_RESET} ${C_WHITE}Mission Loadouts${C_RESET}        ${C_GRAY}- 1-Click Strike Team Skills Swap${C_RESET}"
  echo "  ${C_MAGENTA}[K]${C_RESET} ${C_WHITE}Skills Arsenal${C_RESET}          ${C_GRAY}- Browse & deploy 45+ Q-Branch skills${C_RESET}"
  echo "  ${C_MAGENTA}[M]${C_RESET} ${C_WHITE}Online Model Browser${C_RESET}    ${C_GRAY}- Live Zero-Cost & Discounted gateway models${C_RESET}"
  echo "  ${C_MAGENTA}[H]${C_RESET} ${C_WHITE}Hermes Modes & Split${C_RESET}    ${C_GRAY}- Subagent model, reasoning, resume, worktree${C_RESET}"
  echo "  ${C_MAGENTA}[J]${C_RESET} ${C_WHITE}Jev Intervention & Gate${C_RESET} ${C_GRAY}- Live /v1/systemone latency test & wiring${C_RESET}"
  echo "  ${C_CYAN}[L]${C_RESET} ${C_WHITE}Local Server Audit${C_RESET}      ${C_GRAY}- Scan Mac local servers (lsof), LAN & CORS${C_RESET}"
  echo "  ${C_MAGENTA}[S]${C_RESET} ${C_WHITE}Gateway Settings${C_RESET}        ${C_GRAY}- View/Update API Key & Gateway URL${C_RESET}"
  echo "  ${C_GOLD}[R]${C_RESET} ${C_WHITE}Re-Sync from USB Drive${C_RESET}  ${C_GRAY}- Pull latest keys, skills & scripts from USB${C_RESET}"
  echo ""
  echo "  ${C_RED}[Q]${C_RESET} ${C_WHITE}Q-Branch Signoff${C_RESET}        ${C_GRAY}- Exit${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"

  read -r -p "${C_BOLD}Select operation [1-6, W, I, P, K, M, H, J, L, S, R, Q] (Default 3): ${C_RESET}" choice
  choice="$(echo "${choice:-3}" | tr '[:upper:]' '[:lower:]')"

  case "$choice" in
    q|exit)
      echo ""
      echo "${C_CYAN}Q-Branch: Mission completed. Safe travels, 007.${C_RESET}"
      sleep 1
      exit 0
      ;;
    1)
      run_hermes_with_args ""
      ;;
    2)
      run_hermes_with_args "--tui"
      ;;
    3)
      echo ""
      (cd "$WORK_DIR" && "$NODE_BIN" "$AGENT_SCRIPT")
      echo ""
      read -r -p "Press Enter to return to Q-Branch..." _
      ;;
    4)
      echo ""
      (cd "$WORK_DIR" && "$NODE_BIN" "$AGENT_SCRIPT" --yolo)
      echo ""
      read -r -p "Press Enter to return to Q-Branch..." _
      ;;
    5)
      run_hermes_with_args "--yolo"
      ;;
    6)
      if [ "$CAN_CLAUDE" -eq 0 ]; then
        echo ""
        echo "${C_GOLD}[!] Claude Code requires macOS 13.0 (Ventura) or newer (this Mac is ${MAC_VER}).${C_RESET}"
        echo "${C_WHITE}Options on your Intel i7 MacBook Pro:${C_RESET}"
        echo "  1. Use ${C_GREEN}[3] Q-Branch Direct Agent${C_RESET} (works right now on Catalina 10.15!)"
        echo "  2. Use ${C_GREEN}[1] Hermes Agent${C_RESET} (press [I] to install native Python 3.14 Hermes)"
        echo "  3. Optional: Upgrade via OpenCore Legacy Patcher (macOS 13/14) if you want Claude Code later."
        echo ""
        read -r -p "Press Enter to return to menu..." _
      else
        if command -v claude >/dev/null 2>&1; then
          (cd "$WORK_DIR" && claude)
        else
          echo "${C_CYAN}[*] Launching Claude Code via npx...${C_RESET}"
          (cd "$WORK_DIR" && "$MAC_HOME/runtime/node/bin/npx" -y @anthropic-ai/claude-code)
        fi
        read -r -p "Press Enter to return to menu..." _
      fi
      ;;
    w)
      pick_folder_mac
      ;;
    i)
      install_hermes_mac
      ;;
    p)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" profiles)
      ;;
    k)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" skills)
      ;;
    m)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" models)
      read -r -p "Press Enter to continue..." _
      ;;
    h)
      NODE_TMP="$("$NODE_BIN" -e "console.log(require('os').tmpdir())" 2>/dev/null || echo "/tmp")"
      LAUNCH_FILE="${NODE_TMP%/}/qbranch_hermes_launch.txt"
      rm -f "$LAUNCH_FILE"
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" hermes-modes)
      if [ -f "$LAUNCH_FILE" ]; then
        H_ARGS="$(cat "$LAUNCH_FILE")"
        rm -f "$LAUNCH_FILE"
        if [ -n "$H_ARGS" ]; then
          run_hermes_with_args "$H_ARGS"
        fi
      fi
      ;;
    j)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" jev)
      ;;
    l)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" local-audit)
      ;;
    s)
      (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" config)
      read -r -p "Press Enter to continue..." _
      ;;
    r)
      sync_from_usb 1
      echo "${C_GREEN}[+] Re-synced latest keys, skills & scripts from USB!${C_RESET}"
      sleep 2
      ;;
    *)
      echo "${C_RED}Invalid option.${C_RESET}"
      sleep 1
      ;;
  esac
done
