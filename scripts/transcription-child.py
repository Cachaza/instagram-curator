#!/usr/bin/env python3
"""Cancel model inference when the bridge owner disappears, including SIGKILL."""
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path
from transcription_processes import cancel_members


def main():
    owner_fd = int(sys.argv[1])
    directory = Path(sys.argv[2])
    # The bridge persists process ownership before allowing any model work.
    if os.read(owner_fd, len(b"start")) != b"start":
        return 1
    def owner_lost():
        try:
            while os.read(owner_fd, len(b"start")):
                pass
        finally:
            (directory / "audio.wav").unlink(missing_ok=True)
            os.killpg(os.getpgrp(), signal.SIGKILL)
    threading.Thread(target=owner_lost, daemon=True).start()
    process = subprocess.Popen(sys.argv[3:], close_fds=True)
    status = process.wait()
    cancel_members(os.getpgrp(), exclude=os.getpid())
    return status if status >= 0 else 128 - status


if __name__ == "__main__":
    raise SystemExit(main())
