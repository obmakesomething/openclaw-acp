#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any


def runtime_available(framework: str) -> bool:
    if framework == "langgraph":
        return importlib.util.find_spec("langgraph") is not None
    if framework == "autogen":
        return importlib.util.find_spec("autogen") is not None or importlib.util.find_spec("autogen_agentchat") is not None
    if framework == "crewai":
        return importlib.util.find_spec("crewai") is not None
    if framework == "openhands":
        return shutil.which("openhands") is not None or shutil.which("docker") is not None
    return False


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() not in ("", "0", "false", "no", "off")


def codex_exec_enabled() -> bool:
    return _is_truthy(os.environ.get("AGENT_STACK_ENABLE_CODEX_EXEC", "0"))


def codex_binary() -> str:
    return os.environ.get("AGENT_STACK_CODEX_BIN", "codex")


def codex_available() -> bool:
    binary = codex_binary()
    if Path(binary).is_absolute():
        return Path(binary).exists()
    return shutil.which(binary) is not None


def build_codex_prompt(payload: dict[str, Any], framework: str) -> str:
    goal = str(payload.get("goal") or "").strip()
    context = payload.get("context") or {}
    context_json = json.dumps(context, ensure_ascii=False, indent=2)

    lines = [
        f"[agent-stack worker / framework={framework}]",
        "아래 목표를 실제 파일 산출물까지 완료하라.",
        "가능하면 context.output_file에 반드시 작성하라.",
        "작업 디렉터리 내에서 실행 가능한 결과물을 만든다.",
        "",
        f"goal: {goal}",
        "",
        "context_json:",
        context_json,
    ]
    return "\n".join(lines)


def run_codex_exec(payload: dict[str, Any], framework: str) -> dict[str, Any]:
    context = payload.get("context") or {}
    cwd = str(context.get("cwd") or os.environ.get("AGENT_STACK_DEFAULT_CWD") or os.getcwd())
    timeout = int(context.get("timeout_seconds", os.environ.get("AGENT_STACK_CODEX_TIMEOUT", "900")))
    model = os.environ.get("AGENT_STACK_CODEX_MODEL")
    prompt = build_codex_prompt(payload, framework)
    output_file = Path(tempfile.mkstemp(prefix="agent_stack_codex_", suffix=".txt")[1])

    command = [
        codex_binary(),
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        cwd,
        "--output-last-message",
        str(output_file),
    ]
    if model:
        command.extend(["-m", model])

    try:
        proc = subprocess.run(
            command,
            text=True,
            input=prompt,
            capture_output=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "command": " ".join(command),
            "returncode": 124,
            "stdout": "",
            "stderr": f"codex exec timed out after {timeout}s: {exc}",
            "last_message": "",
        }
    finally:
        pass

    last_message = ""
    try:
        if output_file.exists():
            last_message = output_file.read_text(encoding="utf-8")
    except Exception:
        last_message = ""
    finally:
        try:
            output_file.unlink(missing_ok=True)
        except Exception:
            pass

    return {
        "command": " ".join(command),
        "returncode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
        "last_message": last_message.strip(),
    }


def run_shell_command(context: dict[str, Any]) -> dict[str, Any]:
    command = context.get("shell_command")
    if not command:
        return {}

    timeout = int(context.get("timeout_seconds", 300))
    proc = subprocess.run(
        command,
        shell=True,
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )
    return {
        "command": command,
        "returncode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generic framework worker adapter for Codex agent stack.")
    parser.add_argument("--framework", required=True, choices=("langgraph", "openhands", "autogen", "crewai"))
    args = parser.parse_args(argv)

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"invalid payload: {exc}", file=sys.stderr)
        return 2

    context = payload.get("context") or {}
    shell_result = run_shell_command(context)
    if shell_result and shell_result.get("returncode") not in (None, 0):
        print(json.dumps(shell_result, ensure_ascii=False), file=sys.stderr)
        return int(shell_result["returncode"])

    codex_result: dict[str, Any] = {}
    mode = "shell_command" if shell_result else "goal_only"
    if not shell_result and codex_exec_enabled():
        if not codex_available():
            print(
                json.dumps(
                    {
                        "error": "codex binary not found",
                        "binary": codex_binary(),
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return 127
        codex_result = run_codex_exec(payload, args.framework)
        mode = "codex_exec"
        if codex_result.get("returncode") not in (None, 0):
            print(json.dumps(codex_result, ensure_ascii=False), file=sys.stderr)
            return int(codex_result["returncode"])

    result = {
        "framework": args.framework,
        "goal": payload.get("goal"),
        "runtime_available": runtime_available(args.framework) or (mode == "codex_exec"),
        "mode": mode,
    }
    if shell_result:
        result["shell_result"] = shell_result
    if codex_result:
        result["codex_result"] = codex_result

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
