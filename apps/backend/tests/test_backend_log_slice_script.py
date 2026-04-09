from __future__ import annotations

import os
import shutil
import subprocess
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_SCRIPT = REPO_ROOT / "scripts" / "backend-log-slice.sh"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _prepare_temp_repo(tmp_path: Path) -> tuple[Path, Path]:
    repo_root = tmp_path / "repo"
    script_path = repo_root / "scripts" / "backend-log-slice.sh"
    script_path.parent.mkdir(parents=True)
    shutil.copy2(SOURCE_SCRIPT, script_path)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()

    _write_executable(
        bin_dir / "docker",
        textwrap.dedent(
            """\
            #!/usr/bin/env bash
            set -euo pipefail

            if [[ "$1" == "compose" && "$2" == "config" && "$3" == "--services" ]]; then
              printf 'backend\nmobile\n'
              exit 0
            fi

            if [[ "$1" == "compose" && "$2" == "logs" ]]; then
                            printf '%s\n' \
                                'backend-1  | {"level":"INFO","request_id":"r-1","message":"one"}' \
                                'backend-1  | {"level":"ERROR","request_id":"r-2","message":"two"}' \
                                'backend-1  | not-json' \
                                'backend-1  | {"level":"INFO","request_id":"r-1","message":"three"}'
              exit 0
            fi

            echo "unexpected docker args: $*" >&2
            exit 1
            """
        ),
    )
    _write_executable(
        bin_dir / "jq",
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import json
            import sys

            args = sys.argv[1:]
            request_id_filter = ""
            level_filter = ""
            idx = 0
            while idx < len(args):
                if args[idx] == "--arg" and idx + 2 < len(args):
                    name = args[idx + 1]
                    value = args[idx + 2]
                    if name == "request_id_filter":
                        request_id_filter = value
                    elif name == "level_filter":
                        level_filter = value
                    idx += 3
                    continue
                idx += 1

            for line in sys.stdin:
                line = line.rstrip("\\n")
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if request_id_filter and obj.get("request_id") != request_id_filter:
                    continue
                if level_filter and obj.get("level") != level_filter:
                    continue
                print(json.dumps(obj, separators=(",", ":")))
            """
        ),
    )

    return repo_root, bin_dir


def _run_script(
    repo_root: Path, bin_dir: Path, **env_overrides: str
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(env_overrides)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    return subprocess.run(
        ["bash", str(repo_root / "scripts" / "backend-log-slice.sh")],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_backend_log_slice_rejects_non_positive_limit(tmp_path: Path) -> None:
    repo_root, bin_dir = _prepare_temp_repo(tmp_path)

    result = _run_script(repo_root, bin_dir, LIMIT="0")

    assert result.returncode == 1
    assert "LIMIT must be greater than 0" in result.stderr


def test_backend_log_slice_writes_filtered_limited_output_and_updates_symlink(
    tmp_path: Path,
) -> None:
    repo_root, bin_dir = _prepare_temp_repo(tmp_path)
    out_path = repo_root / "tmp" / "slice.ndjson"

    result = _run_script(
        repo_root,
        bin_dir,
        REQUEST_ID="r-1",
        LEVEL="INFO",
        LIMIT="1",
        OUT=str(out_path),
    )

    assert result.returncode == 0
    assert out_path.read_text(encoding="utf-8").splitlines() == [
        '{"level":"INFO","request_id":"r-1","message":"three"}'
    ]
    latest = repo_root / "logs" / "agent-latest.ndjson"
    assert latest.is_symlink()
    assert latest.resolve() == out_path.resolve()
    assert f"Wrote 1 lines to {out_path}" in result.stdout
    assert "Symlink" in result.stdout
