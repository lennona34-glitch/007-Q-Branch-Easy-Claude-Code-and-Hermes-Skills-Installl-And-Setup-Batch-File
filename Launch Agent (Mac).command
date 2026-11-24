#!/usr/bin/env bash
# ==============================================================================
# 007 Q-BRANCH : SMART MACOS AGENT COMMAND CENTER (OS X 10.8 Mountain Lion -> macOS 15+)
# - Automatic 007 Dark Mode in Terminal.app (switches Basic white -> Pro dark)
# - Auto-selects Node v10.24.1 (minos=10.7.0, OpenSSL 1.1.1 TLS 1.3) + qbranch-legacy.cjs
#   on OS X 10.7-10.14 (zero chkstk_darwin crashes!)
# - Auto-selects Node v20.20.2 + full qbranch.mjs + Hermes/Claude on macOS 10.15+
# - Handles Read-Only NTFS USB drives automatically via ~/Q-Branch-Mac mirror
# - 100% Bash 3.2 compatible (built-in OS X bash)
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
# 0. Apply 007 Dark Mode in macOS Terminal.app (works from OS X 10.8 -> macOS 15+)
# ------------------------------------------------------------------------------
apply_dark_mode() {
  osascript >/dev/null 2>&1 <<'EOF' || true
tell application "Terminal"
  try
    set current settings of front window to settings set "Pro"
  on error
    try
      set background color of front window to {2500, 3500, 5200}
      set normal text color of front window to {58000, 61000, 64000}
      set bold text color of front window to {65535, 65535, 65535}
      set cursor color of front window to {0, 60000, 60000}
    end try
  end try
end tell
EOF
  printf '\033[40m\033[37m\033[2J\033[H'
}

apply_dark_mode

# ------------------------------------------------------------------------------
# 1. Detect Hardware, OS X / macOS Version & USB Volume
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_VER="$(sw_vers -productVersion 2>/dev/null || echo '10.8.5')"
MAC_ARCH="$(uname -m 2>/dev/null || echo 'x86_64')"
MAC_MAJOR="$(echo "$MAC_VER" | awk -F. '{print $1+0}')"
MAC_MINOR="$(echo "$MAC_VER" | awk -F. '{print $2+0}')"

IS_LEGACY_MAC=0
CAN_HERMES=1
CAN_CLAUDE=0
RUNTIME_TIER="modern-v20"

if [ "$MAC_MAJOR" -eq 10 ] && [ "$MAC_MINOR" -lt 15 ]; then
  IS_LEGACY_MAC=1
  RUNTIME_TIER="legacy-v10"
fi
if [ "$MAC_MAJOR" -eq 10 ] && [ "$MAC_MINOR" -lt 12 ]; then
  CAN_HERMES=0
fi
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
    USB_MODE="USB NTFS READ-ONLY -> ~/Q-Branch-Mac"
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
  local tier_file="$MAC_HOME/runtime/node/.qbranch_runtime_tier"
  local cur_tier=""
  [ -f "$tier_file" ] && cur_tier="$(cat "$tier_file" 2>/dev/null || true)"

  if [ -x "$MAC_HOME/runtime/node/bin/node" ] && [ "$cur_tier" = "$RUNTIME_TIER" ]; then
    if "$MAC_HOME/runtime/node/bin/node" -v >/dev/null 2>&1; then
      return 0
    fi
  fi

  local TAR_SRC=""
  if [ "$IS_LEGACY_MAC" -eq 1 ]; then
    echo "${C_GOLD}[*] OS X ${MAC_VER} detected — installing Legacy Mac Node.js v10.24.1 (minos=10.7.0, OpenSSL TLS 1.3)...${C_RESET}"
    if [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/runtime/mac/node-darwin-x64-legacy.tar.gz" ]; then
      TAR_SRC="$USB_ROOT/runtime/mac/node-darwin-x64-legacy.tar.gz"
      echo "${C_GREEN}  [+] Found pre-bundled Mountain Lion Node v10.24.1 on USB! Extracting to SSD...${C_RESET}"
    else
      echo "${C_RED}  [!] node-darwin-x64-legacy.tar.gz not found on USB (OS X ${MAC_VER} curl cannot use TLS 1.3).${C_RESET}"
      echo "${C_WHITE}  Please copy runtime/mac/node-darwin-x64-legacy.tar.gz from Windows to USB.${C_RESET}"
      return 1
    fi
  else
    echo "${C_GOLD}[*] Setting up macOS Node.js 20 runtime in ~/Q-Branch-Mac/runtime/node...${C_RESET}"
    local NODE_ARCH="x64"
    if [ "$MAC_ARCH" = "arm64" ]; then
      NODE_ARCH="arm64"
    fi
    if [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/runtime/mac/node-darwin-${NODE_ARCH}.tar.gz" ]; then
      TAR_SRC="$USB_ROOT/runtime/mac/node-darwin-${NODE_ARCH}.tar.gz"
      echo "${C_GREEN}  [+] Found pre-bundled Node.js 20 tarball on USB! Extracting to SSD...${C_RESET}"
    elif [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/runtime/mac/node-darwin-x64.tar.gz" ]; then
      TAR_SRC="$USB_ROOT/runtime/mac/node-darwin-x64.tar.gz"
      echo "${C_GREEN}  [+] Found pre-bundled Intel x64 Node.js 20 tarball on USB! Extracting...${C_RESET}"
    else
      TAR_SRC="/tmp/qbranch-node-v20.20.2-darwin-${NODE_ARCH}.tar.gz"
      local NODE_URL="https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-${NODE_ARCH}.tar.gz"
      echo "${C_CYAN}  [*] Downloading Node.js v20.20.2 (${NODE_ARCH}) from nodejs.org...${C_RESET}"
      curl -fL "$NODE_URL" -o "$TAR_SRC" || {
        echo "${C_RED}  [!] Failed to download Node.js.${C_RESET}"
        return 1
      }
    fi
  fi

  rm -rf "$MAC_HOME/runtime/node"
  mkdir -p "$MAC_HOME/runtime/node"
  tar -xzf "$TAR_SRC" -C "$MAC_HOME/runtime/node" --strip-components=1 || return 1
  chmod +x "$MAC_HOME/runtime/node/bin/"* 2>/dev/null || true
  xattr -dr com.apple.quarantine "$MAC_HOME/runtime/node" 2>/dev/null || true
  printf '%s' "$RUNTIME_TIER" > "$tier_file"

  if "$MAC_HOME/runtime/node/bin/node" -v >/dev/null 2>&1; then
    echo "${C_GREEN}  [+] Node.js ready: $("$MAC_HOME/runtime/node/bin/node" -v)${C_RESET}"
    return 0
  fi
  echo "${C_RED}  [!] Node binary failed self-check on OS X ${MAC_VER}.${C_RESET}"
  return 1
}

rewrite_mac_paths() {
  local node_bin="$MAC_HOME/runtime/node/bin/node"
  [ -x "$node_bin" ] || return 0
  "$node_bin" -e '
    var fs = require("fs");
    var path = require("path");
    var macHome = process.env.QBRANCH_MAC_HOME;
    var nodeBin = path.join(macHome, "runtime", "node", "bin", "node");
    var jevCli = path.join(macHome, "runtime", "jev-use", "node_modules", "jev-use", "dist", "cli.js");
    var hasJev = fs.existsSync(jevCli);

    function mkdirp(d) {
      if (fs.existsSync(d)) return;
      try { fs.mkdirSync(d, { recursive: true }); }
      catch (e) { mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e2) {} }
    }

    var sPath = path.join(macHome, "config", "claude", "settings.json");
    var settings = { env: {}, permissions: {} };
    if (fs.existsSync(sPath)) {
      try { settings = JSON.parse(fs.readFileSync(sPath, "utf8")); } catch (e) {}
    }
    settings.env = settings.env || {};
    var apiKey = settings.env.TYPESAFE_API_KEY || settings.env.ANTHROPIC_AUTH_TOKEN || "";
    var rawBase = settings.env.TYPESAFE_BASE_URL || settings.env.ANTHROPIC_BASE_URL || "https://api.experientiallabs.ai";
    var baseOrigin = rawBase.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    var primary = settings.env.ANTHROPIC_MODEL || "gpt-6-luna";
    var fast = settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "deepseek-v4.1-flash-1017";
    if (apiKey) settings.env.TYPESAFE_API_KEY = apiKey;
    settings.env.TYPESAFE_BASE_URL = baseOrigin;
    mkdirp(path.dirname(sPath));
    fs.writeFileSync(sPath, JSON.stringify(settings, null, 2), "utf8");

    var cjPath = path.join(macHome, "config", "claude", ".claude.json");
    var cj = {};
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

    var hDir = path.join(macHome, "config", "hermes");
    mkdirp(hDir);
    var hCfgPath = path.join(hDir, "config.yaml");
    var reasoning = "none";
    if (fs.existsSync(hCfgPath)) {
      var oldRaw = fs.readFileSync(hCfgPath, "utf8");
      var rm = oldRaw.match(/reasoning_effort:\s*"([^"]+)"/);
      if (rm) reasoning = rm[1];
    }
    var hermesYaml = [
      "# 007 Q-Branch macOS Configuration",
      "_config_version: 53",
      "model:",
      "  default: \"" + primary + "\"",
      "  provider: \"custom\"",
      "  base_url: \"" + baseOrigin + "/v1\"",
      "  api_key: \"" + apiKey + "\"",
      "agent:",
      "  reasoning_effort: \"" + reasoning + "\"",
      "delegation:",
      "  model: \"" + fast + "\"",
      "  max_iterations: 250",
      "mcp_servers:",
      "  jev:",
      "    command: \"" + (hasJev ? nodeBin : "npx") + "\"",
      "    args: " + (hasJev ? JSON.stringify([jevCli, "serve"]) : JSON.stringify(["-y", "jev-use@0.8.0", "serve"])),
      "    env:",
      "      TYPESAFE_API_KEY: \"" + apiKey + "\"",
      "      TYPESAFE_BASE_URL: \"" + baseOrigin + "\"",
      "runtime:",
      "  nofile_soft_limit: 4096",
      "tools:",
      "  tool_search:",
      "    enabled: \"off\"",
      ""
    ].join("\n");
    fs.writeFileSync(hCfgPath, hermesYaml, "utf8");

    var hermesEnv = [
      "# 007 Q-Branch macOS Environment",
      "OPENAI_API_KEY=" + apiKey,
      "OPENAI_BASE_URL=" + baseOrigin + "/v1",
      "CUSTOM_API_KEY=" + apiKey,
      "TYPESAFE_API_KEY=" + apiKey,
      "TYPESAFE_BASE_URL=" + baseOrigin,
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
  [ -f "$USB_ROOT/qbranch-legacy.cjs" ] && cp -f "$USB_ROOT/qbranch-legacy.cjs" "$MAC_HOME/qbranch-legacy.cjs"
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

NODE_BIN="$MAC_HOME/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || echo node)"
fi

if [ "$IS_LEGACY_MAC" -eq 1 ]; then
  QBRANCH_SCRIPT="$MAC_HOME/qbranch-legacy.cjs"
else
  QBRANCH_SCRIPT="$MAC_HOME/qbranch.mjs"
fi
AGENT_SCRIPT="$MAC_HOME/qbranch-agent.mjs"

run_qbranch_cmd() {
  local subcmd="$1"
  shift || true
  (cd "$WORK_DIR" && "$NODE_BIN" "$QBRANCH_SCRIPT" "$subcmd" "$@")
}

run_direct_agent() {
  if [ "$IS_LEGACY_MAC" -eq 1 ]; then
    (cd "$WORK_DIR" && "$NODE_BIN" "$MAC_HOME/qbranch-legacy.cjs" agent "$@")
  else
    (cd "$WORK_DIR" && "$NODE_BIN" "$AGENT_SCRIPT" "$@")
  fi
}

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
  if [ "$CAN_HERMES" -eq 0 ]; then
    echo "${C_GOLD}[!] Native Hermes Agent requires macOS 10.12+ (Sierra / Catalina / Ventura).${C_RESET}"
    echo "${C_WHITE}    This MacBook is running OS X ${MAC_VER} (Mountain Lion):${C_RESET}"
    echo "${C_GRAY}    - System curl on 10.8 only speaks TLS 1.0 (rejected by modern HTTPS servers)${C_RESET}"
    echo "${C_GRAY}    - Hermes Python 3.14 / uv binaries require macOS 10.12+${C_RESET}"
    echo ""
    echo "${C_GREEN}[+] Good news! Q-Branch Direct Agent [1] / [2] runs NATIVELY on OS X ${MAC_VER}${C_RESET}"
    echo "${C_WHITE}    with Node v10.24.1 (OpenSSL TLS 1.3), full tool calling, Jev, and all 45+ skills!${C_RESET}"
    echo "${C_GRAY}    (Tip: If you ever upgrade this i7 MacBook via OpenCore Legacy Patcher to macOS 13+,${C_RESET}"
    echo "${C_GRAY}     both Hermes Agent AND Claude Code will unlock automatically!)${C_RESET}"
    echo ""
    read -r -p "Press Enter to return to menu..." _
    return 0
  fi

  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "${C_GOLD} 007 Q-BRANCH : INSTALL / REPAIR HERMES AGENT ON MACOS ${MAC_VER} (${MAC_ARCH})${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
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
    echo "${C_WHITE}Tip: You can still use Q-Branch Direct Agent immediately!${C_RESET}"
  fi
  echo ""
  read -r -p "Press Enter to return to menu..." _
}

run_hermes_with_args() {
  local extra_args="${1:-}"
  if [ "$CAN_HERMES" -eq 0 ]; then
    install_hermes_mac
    return 0
  fi
  local hbin
  hbin="$(find_hermes_bin)"
  if [ -z "$hbin" ]; then
    echo ""
    echo "${C_GOLD}[!] Hermes Agent is not installed on this Mac yet.${C_RESET}"
    read -r -p "Install Hermes now? [Y/n]: " ans
    local ans_low
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
  while true; do
    clear
    echo "${C_CYAN}==============================================================================${C_RESET}"
    echo "${C_GOLD}              007 Q-BRANCH : TARGET FOLDER SELECTION (MACOS)                  ${C_RESET}"
    echo "${C_CYAN}==============================================================================${C_RESET}"
    echo "  Current Operational Folder : ${C_WHITE}${WORK_DIR}${C_RESET}"
    echo ""
    echo "  ${C_GREEN}[1]${C_RESET} Browse with macOS Finder Dialog (GUI)"
    echo "  ${C_CYAN}[2]${C_RESET} Type or Drag-and-Drop Folder into Terminal"
    echo "  ${C_GOLD}[3]${C_RESET} Quick Jump: Desktop  (${HOME}/Desktop)"
    echo "  ${C_GOLD}[4]${C_RESET} Quick Jump: Home     (${HOME})"
    echo "  ${C_RED}[0]${C_RESET} Return to Main Menu"
    echo ""
    read -r -p "Select option [1-4, 0]: " pchoice
    case "$pchoice" in
      0|q|Q|"")
        return 0
        ;;
      1)
        echo "${C_CYAN}[*] Opening macOS Finder folder picker...${C_RESET}"
        local picked=""
        local osa_rc=0
        picked="$(osascript 2>&1 <<'EOF'
tell application "Finder"
  activate
  set chosenFolder to choose folder with prompt "007 Q-Branch: Select Project Folder"
  return POSIX path of chosenFolder
end tell
EOF
)" || osa_rc=$?
        osascript -e 'tell application "Terminal" to activate' >/dev/null 2>&1 || true
        if [ "$osa_rc" -eq 0 ] && [ -n "$picked" ] && [ -d "$picked" ]; then
          WORK_DIR="${picked%/}"
          [ -z "$WORK_DIR" ] && WORK_DIR="/"
          echo "${C_GREEN}[+] Operational folder locked: ${WORK_DIR}${C_RESET}"
          sleep 1
          return 0
        elif echo "$picked" | grep -q -- "-128"; then
          echo "${C_GRAY}[*] Finder picker cancelled.${C_RESET}"
          sleep 1
        else
          echo "${C_GOLD}[!] Finder dialog note: ${picked}${C_RESET}"
          echo "${C_WHITE}    Use [2] to drag any folder from Finder directly into this window!${C_RESET}"
          read -r -p "Press Enter to continue..." _
        fi
        ;;
      2)
        echo "${C_GRAY}Tip: You can drag a folder from Finder straight into this Terminal window, then press Enter.${C_RESET}"
        read -r -p "Folder path: " mpath
        # Trim leading/trailing spaces & quotes, expand ~, unescape Finder drag-and-drop '\ ' spaces
        mpath="$(printf '%s' "$mpath" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^"//; s/"$//; s/^'\''//; s/'\''$//; s/\\ / /g')"
        case "$mpath" in
          "~"*) mpath="${HOME}${mpath#\~}" ;;
        esac
        if [ -n "$mpath" ] && [ -d "$mpath" ]; then
          WORK_DIR="$(cd "$mpath" && pwd)"
          echo "${C_GREEN}[+] Operational folder locked: ${WORK_DIR}${C_RESET}"
          sleep 1
          return 0
        else
          echo "${C_RED}[!] Folder not found: ${mpath}${C_RESET}"
          read -r -p "Press Enter to try again..." _
        fi
        ;;
      3)
        if [ -d "$HOME/Desktop" ]; then
          WORK_DIR="$HOME/Desktop"
          echo "${C_GREEN}[+] Operational folder locked: ${WORK_DIR}${C_RESET}"
          sleep 1
          return 0
        fi
        ;;
      4)
        WORK_DIR="$HOME"
        echo "${C_GREEN}[+] Operational folder locked: ${WORK_DIR}${C_RESET}"
        sleep 1
        return 0
        ;;
      *)
        echo "${C_RED}Invalid option.${C_RESET}"
        sleep 1
        ;;
    esac
  done
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

  if [ -f "$QBRANCH_SCRIPT" ] && "$NODE_BIN" -v >/dev/null 2>&1; then
    while IFS='=' read -r k v; do
      case "$k" in
        Q_PRIMARY) Q_PRIMARY="$v" ;;
        Q_FAST) Q_FAST="$v" ;;
        Q_JEV_STATUS) Q_JEV_STATUS="$v" ;;
        Q_JEV_GATE) Q_JEV_GATE="$v" ;;
      esac
    done < <("$NODE_BIN" "$QBRANCH_SCRIPT" env-summary 2>/dev/null || true)
  fi

  NODE_VER_STR="$("$NODE_BIN" -v 2>/dev/null || echo 'missing')"
  HERMES_BIN="$(find_hermes_bin)"
  if [ "$CAN_HERMES" -eq 0 ]; then
    HERMES_STATUS="${C_GRAY}N/A on OS X ${MAC_VER} (Direct Agent active instead!)${C_RESET}"
  elif [ -n "$HERMES_BIN" ]; then
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
  if [ "$IS_LEGACY_MAC" -eq 1 ]; then
    echo "${C_MAGENTA}       AI AGENT COMMAND CENTER | OS X LEGACY EDITION (DARK MODE)              ${C_RESET}"
  else
    echo "${C_MAGENTA}       AI AGENT COMMAND CENTER | MACOS PORTABLE EDITION (DARK MODE)           ${C_RESET}"
  fi
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo "  ${C_GRAY}MAC HARDWARE       :${C_RESET} ${C_WHITE}OS X ${MAC_VER} (${MAC_ARCH}) | Node ${NODE_VER_STR} (TLS 1.3)${C_RESET}"
  echo "  ${C_GRAY}STORAGE / SYNC     :${C_RESET} ${C_GREEN}${USB_MODE}${C_RESET}"
  echo "  ${C_GRAY}OPERATIONAL FOLDER :${C_RESET} ${C_WHITE}${WORK_DIR}${C_RESET}"
  echo "  ${C_GRAY}ACTIVE TEAM        :${C_RESET} ${C_GOLD}${Q_PRIMARY}${C_RESET} + ${C_CYAN}${Q_FAST}${C_RESET}"
  echo "  ${C_GRAY}JEV INTERVENTION   :${C_RESET} ${C_GREEN}${Q_JEV_STATUS}${C_RESET} ${C_GRAY}[/v1/systemone ready]${C_RESET}"
  echo "  ${C_GRAY}HERMES ENGINE      :${C_RESET} ${HERMES_STATUS}"
  echo "${C_CYAN}==============================================================================${C_RESET}"
  echo ""
  if [ "$IS_LEGACY_MAC" -eq 1 ]; then
    echo "  ${C_GREEN}[1]${C_RESET} ${C_WHITE}Q-Branch Direct Agent${C_RESET}   ${C_GOLD}[OS X ${MAC_VER} Native]${C_GRAY} Coding agent + shell/files/Jev${C_RESET}"
    echo "  ${C_GOLD}[2]${C_RESET} ${C_WHITE}Q-Branch Direct (YOLO)${C_RESET}  ${C_GRAY}- Auto-approve shell & file edits${C_RESET}"
    echo "  ${C_GRAY}[3] Hermes Agent${C_RESET}            ${C_GRAY}- Requires macOS 10.12+ (Detected ${MAC_VER})${C_RESET}"
    echo "  ${C_GRAY}[6] Claude Code${C_RESET}             ${CLAUDE_LABEL}"
    DEFAULT_CHOICE="1"
  else
    echo "  ${C_GREEN}[1]${C_RESET} ${C_WHITE}Hermes Agent${C_RESET}            ${C_GRAY}- Synced Split [${Q_PRIMARY} + Subagent ${Q_FAST}]${C_RESET}"
    echo "  ${C_GREEN}[2]${C_RESET} ${C_WHITE}Hermes Agent (TUI)${C_RESET}      ${C_GRAY}- Visual Dashboard Interface [${Q_PRIMARY}]${C_RESET}"
    echo "  ${C_GREEN}[3]${C_RESET} ${C_WHITE}Q-Branch Direct Agent${C_RESET}   ${C_GOLD}[Zero-Install]${C_GRAY} Native coding agent + tools${C_RESET}"
    echo "  ${C_GOLD}[4]${C_RESET} ${C_WHITE}Q-Branch Direct (YOLO)${C_RESET}  ${C_GRAY}- Auto-approve shell & file edits${C_RESET}"
    echo "  ${C_GOLD}[5]${C_RESET} ${C_WHITE}Hermes Agent (YOLO)${C_RESET}     ${C_GRAY}- Auto-approve Hermes commands${C_RESET}"
    echo "  ${C_GRAY}[6] Claude Code${C_RESET}             ${CLAUDE_LABEL}"
    DEFAULT_CHOICE="3"
  fi
  echo ""
  echo "  ${C_CYAN}--- Q-BRANCH ARSENAL & MAC TOOLS ---${C_RESET}"
  echo "  ${C_CYAN}[W]${C_RESET} ${C_WHITE}Select Project Folder${C_RESET}   ${C_GRAY}- Finder GUI Picker or Drag-and-Drop${C_RESET}"
  if [ "$CAN_HERMES" -eq 1 ]; then
    echo "  ${C_CYAN}[I]${C_RESET} ${C_WHITE}Install/Repair Hermes${C_RESET}   ${C_GRAY}- Setup Hermes Agent + Jev MCP on this Mac${C_RESET}"
    echo "  ${C_MAGENTA}[P]${C_RESET} ${C_WHITE}Mission Loadouts${C_RESET}        ${C_GRAY}- 1-Click Strike Team Skills Swap${C_RESET}"
    echo "  ${C_MAGENTA}[H]${C_RESET} ${C_WHITE}Hermes Modes & Split${C_RESET}    ${C_GRAY}- Subagent model, reasoning, resume, worktree${C_RESET}"
  fi
  echo "  ${C_MAGENTA}[K]${C_RESET} ${C_WHITE}Skills Arsenal${C_RESET}          ${C_GRAY}- Browse & deploy 45+ Q-Branch skills${C_RESET}"
  echo "  ${C_MAGENTA}[M]${C_RESET} ${C_WHITE}Online Model Browser${C_RESET}    ${C_GRAY}- Live Zero-Cost & Discounted gateway models${C_RESET}"
  echo "  ${C_MAGENTA}[J]${C_RESET} ${C_WHITE}Jev Intervention & Test${C_RESET} ${C_GRAY}- Live /v1/systemone latency test (jev & clef)${C_RESET}"
  echo "  ${C_CYAN}[L]${C_RESET} ${C_WHITE}Local Server Audit${C_RESET}      ${C_GRAY}- Scan Mac local servers (lsof), LAN & CORS${C_RESET}"
  echo "  ${C_MAGENTA}[S]${C_RESET} ${C_WHITE}Gateway Settings${C_RESET}        ${C_GRAY}- View/Update API Key & Gateway URL${C_RESET}"
  echo "  ${C_GOLD}[R]${C_RESET} ${C_WHITE}Re-Sync from USB Drive${C_RESET}  ${C_GRAY}- Pull latest keys, skills & scripts from USB${C_RESET}"
  echo "  ${C_CYAN}[D]${C_RESET} ${C_WHITE}Apply Dark Mode Theme${C_RESET}   ${C_GRAY}- Switch Terminal window to 007 Dark Pro theme${C_RESET}"
  echo ""
  echo "  ${C_RED}[Q]${C_RESET} ${C_WHITE}Q-Branch Signoff${C_RESET}        ${C_GRAY}- Exit${C_RESET}"
  echo "${C_CYAN}==============================================================================${C_RESET}"

  read -r -p "${C_BOLD}Select operation (Default ${DEFAULT_CHOICE}): ${C_RESET}" choice
  choice="$(echo "${choice:-$DEFAULT_CHOICE}" | tr '[:upper:]' '[:lower:]')"

  case "$choice" in
    q|exit)
      echo ""
      echo "${C_CYAN}Q-Branch: Mission completed. Safe travels, 007.${C_RESET}"
      sleep 1
      exit 0
      ;;
    1)
      if [ "$IS_LEGACY_MAC" -eq 1 ]; then
        echo ""
        run_direct_agent
        echo ""
        read -r -p "Press Enter to return to Q-Branch..." _
      else
        run_hermes_with_args ""
      fi
      ;;
    2)
      if [ "$IS_LEGACY_MAC" -eq 1 ]; then
        echo ""
        run_direct_agent --yolo
        echo ""
        read -r -p "Press Enter to return to Q-Branch..." _
      else
        run_hermes_with_args "--tui"
      fi
      ;;
    3)
      if [ "$IS_LEGACY_MAC" -eq 1 ]; then
        install_hermes_mac
      else
        echo ""
        run_direct_agent
        echo ""
        read -r -p "Press Enter to return to Q-Branch..." _
      fi
      ;;
    4)
      echo ""
      run_direct_agent --yolo
      echo ""
      read -r -p "Press Enter to return to Q-Branch..." _
      ;;
    5)
      run_hermes_with_args "--yolo"
      ;;
    6)
      if [ "$CAN_CLAUDE" -eq 0 ]; then
        echo ""
        echo "${C_GOLD}[!] Claude Code requires macOS 13.0 (Ventura) or newer (this Mac is OS X ${MAC_VER}).${C_RESET}"
        echo "${C_WHITE}    Use [1] Q-Branch Direct Agent right now on OS X ${MAC_VER}!${C_RESET}"
        echo "${C_GRAY}    (Or upgrade via OpenCore Legacy Patcher if you want native Claude Code later.)${C_RESET}"
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
    d)
      apply_dark_mode
      ;;
    i)
      install_hermes_mac
      ;;
    p)
      if [ "$IS_LEGACY_MAC" -eq 1 ]; then
        run_qbranch_cmd skills
      else
        run_qbranch_cmd profiles
      fi
      ;;
    k)
      run_qbranch_cmd skills
      ;;
    m)
      run_qbranch_cmd models
      read -r -p "Press Enter to continue..." _
      ;;
    h)
      if [ "$CAN_HERMES" -eq 0 ]; then
        install_hermes_mac
      else
        NODE_TMP="$("$NODE_BIN" -e "console.log(require('os').tmpdir())" 2>/dev/null || echo "/tmp")"
        LAUNCH_FILE="${NODE_TMP%/}/qbranch_hermes_launch.txt"
        rm -f "$LAUNCH_FILE"
        run_qbranch_cmd hermes-modes
        if [ -f "$LAUNCH_FILE" ]; then
          H_ARGS="$(cat "$LAUNCH_FILE")"
          rm -f "$LAUNCH_FILE"
          if [ -n "$H_ARGS" ]; then
            run_hermes_with_args "$H_ARGS"
          fi
        fi
      fi
      ;;
    j)
      run_qbranch_cmd jev
      ;;
    l)
      run_qbranch_cmd local-audit
      ;;
    s)
      run_qbranch_cmd config
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
