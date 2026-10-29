"""OS process-group cancellation without polling or an arbitrary grace period."""
import os
import select
import signal
import subprocess


def group_members(group):
    rows = subprocess.check_output(["ps", "-axo", "pid=,pgid=,stat=,args="], text=True,
                                   start_new_session=True).splitlines()
    members = []
    for row in rows:
        parts = row.split(None, 3)
        if len(parts) == 4 and int(parts[1]) == group and not parts[2].startswith("Z"):
            members.append((int(parts[0]), parts[3]))
    return members


def cancel_members(group, exclude=None):
    # Keep the supervisor alive while it cancels/reaps surviving helpers. Other
    # callers cancel the complete previously verified group.
    while True:
        members = [(pid, command) for pid, command in group_members(group) if pid != exclude]
        if not members:
            return
        descriptors = []
        queue = select.kqueue() if hasattr(select, "kqueue") else None
        watched = set()
        try:
            for pid, _ in members:
                try:
                    if queue:
                        queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                                     flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                                     fflags=select.KQ_NOTE_EXIT)], 0)
                        watched.add(pid)
                    else:
                        descriptors.append(os.pidfd_open(pid))
                except ProcessLookupError:
                    pass
            for pid, _ in members:
                try:
                    if os.getpgid(pid) == group:
                        os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if queue:
                while watched:
                    for event in queue.control(None, len(watched)):
                        watched.discard(event.ident)
            else:
                while descriptors:
                    ready, _, _ = select.select(descriptors, [], [])
                    for descriptor in ready:
                        os.close(descriptor)
                        descriptors.remove(descriptor)
        finally:
            if queue:
                queue.close()
            for descriptor in descriptors:
                os.close(descriptor)
