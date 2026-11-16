#!/usr/bin/env python3
"""The pull requests each Claude Code agent in herdr opened, with their state.

Prints {"<terminal address>": [pr, ...]} as JSON, newest PR last, where pr is
{repo, number, url, title, state, draft, review, checks}. state is OPEN, CLOSED
or MERGED; checks is SUCCESS, FAILURE, PENDING, ... or null.

Which session a terminal runs: Claude Code on this computer registers itself in
~/.claude/sessions/<pid>.json. Under apod (Claude Code in a container) that
registry isn't usable, so the session is the one in the profile's project
folder whose title is the terminal's title. Claude Code records each PR a
session opens as a "pr-link" line in its session file.
"""
import json, os, re, subprocess, sys, time

HOME = os.path.expanduser("~")
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.join(HOME, ".cache")), "herdr-config", "pr-links.json")


def run(*argv, timeout=30, any_exit=False):
    """Its stdout, or "" when it failed. any_exit: stdout whatever the exit code (gh exits 1
    when one part of a GraphQL query fails, and still prints the rest)."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout if r.returncode == 0 or any_exit else ""


# The scan cache, saved now and then while scanning, so a run the sidebar cuts short
# (it waits 60 s) keeps what it read. Its own temp name: two herdr windows run this at once.
SAVE_EVERY = 10
_saved_at = time.monotonic()
USED = set()  # session files looked at this run


def save(cache):
    global _saved_at
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = f"{CACHE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, CACHE)
    _saved_at = time.monotonic()


def clean(s):
    """A title without what Claude Code puts in front of it (status glyphs)."""
    return re.sub(r"^[^\w\[(]+", "", s or "").strip()


def project_dir(base, cwd):
    return os.path.join(base, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd))


def scan(path, cache):
    """(custom title, ai title, [pr-link, ...]) of a session file, cached by size and mtime."""
    st = os.stat(path)
    key = f"{st.st_size}:{st.st_mtime_ns}"
    hit = cache.get(path)
    USED.add(path)
    if hit and hit["key"] == key:
        return hit["custom"], hit["ai"], [tuple(p) for p in hit["prs"]]
    if time.monotonic() - _saved_at > SAVE_EVERY:
        save(cache)
    custom = ai = None
    prs = []
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            if '"custom-title"' not in line and '"ai-title"' not in line and '"pr-link"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            t = d.get("type")
            if t == "custom-title":
                custom = d.get("customTitle")
            elif t == "ai-title":
                ai = d.get("aiTitle")
            elif t == "pr-link" and d.get("prRepository") and d.get("prNumber"):
                pr = (d["prRepository"], d["prNumber"])
                if pr in prs:
                    prs.remove(pr)
                prs.append(pr)
    cache[path] = {"key": key, "custom": custom, "ai": ai, "prs": prs}
    return custom, ai, [tuple(p) for p in prs]


def session_file(t, cache):
    fg = t.get("foreground") or {}
    argv = fg.get("argv") or []
    cwd = fg.get("cwd") or t.get("cwd")
    if not cwd:
        return None
    # Claude Code on this computer: its own registry names the session.
    reg = os.path.join(HOME, ".claude", "sessions", f"{fg.get('pid')}.json")
    if os.path.exists(reg):
        try:
            with open(reg) as f:
                sid = json.load(f).get("sessionId")
            path = os.path.join(project_dir(HOME, cwd), f"{sid}.jsonl")
            if os.path.exists(path):
                return path
        except (OSError, ValueError):
            pass
    # apod: `bash .../apod <profile> ...`, or podman with an apod.profile label.
    profile = None
    if len(argv) > 2 and argv[1].endswith("/apod"):
        profile = argv[2]
    profile = profile or next((a.split("=", 1)[1] for a in argv if a.startswith("apod.profile=")), None)
    base = os.path.join(HOME, ".agent-pod", profile, "home") if profile else HOME
    title = clean(t.get("title"))
    if not title or title == "Claude Code":  # untitled: would match any session
        return None
    projects = os.path.join(base, ".claude", "projects")
    here = project_dir(base, cwd)
    # The terminal's folder first. A container may have moved to another one, so
    # then every folder of that profile, only sessions written in the last 30 days.
    for folders, recent in (([here], 0), (sorted(os.listdir(projects)) if os.path.isdir(projects) else [], 30 * 86400)):
        files = []
        for folder in folders:
            folder = os.path.join(projects, folder) if not os.path.isabs(folder) else folder
            if os.path.isdir(folder):
                files += [os.path.join(folder, n) for n in os.listdir(folder) if n.endswith(".jsonl")]
        if recent:

            files = [p for p in files if time.time() - os.path.getmtime(p) < recent]
        for path in sorted(files, key=os.path.getmtime, reverse=True):
            custom, ai, _ = scan(path, cache)
            if title in (clean(custom), clean(ai)):
                return path
    return None


QUERY_PR = """%s: repository(owner: %s, name: %s) { pullRequest(number: %d) {
  url title state isDraft reviewDecision
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }"""


def states(prs):
    """One GraphQL request for every PR."""
    if not prs:
        return {}
    parts = []
    for i, (repo, num) in enumerate(prs):
        owner, name = repo.split("/", 1)
        parts.append(QUERY_PR % (f"p{i}", json.dumps(owner), json.dumps(name), num))
    out = run("gh", "api", "graphql", "-f", "query={" + "\n".join(parts) + "}", any_exit=True)
    try:
        data = json.loads(out).get("data") if out else None
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return None  # no answer at all (offline, logged out): not the same as no PRs
    # A PR GitHub can't find (repo gone, no access) is null here; the others are still good.
    res = {}
    for i, (repo, num) in enumerate(prs):
        pr = ((data.get(f"p{i}") or {}).get("pullRequest")) or {}
        if not pr:
            continue
        nodes = (pr.get("commits") or {}).get("nodes") or []
        rollup = ((nodes[0].get("commit") or {}).get("statusCheckRollup") or {}) if nodes else {}
        res[(repo, num)] = {"repo": repo, "number": num, "url": pr["url"], "title": pr["title"],
                            "state": pr["state"], "draft": pr["isDraft"], "review": pr["reviewDecision"],
                            "checks": rollup.get("state")}
    return res


def main():
    try:
        with open(CACHE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    # A failed run exits non-zero: the sidebar then keeps the badges it has, rather than
    # taking an empty answer as every PR gone.
    out = run("hc", "ls", "--json")
    if not out:
        sys.exit("prs.py: hc ls failed")
    ls = json.loads(out)
    found = {}
    for t in ls.get("terminals", []):
        if t.get("agent") != "claude-code" or "/" in t["address"]:
            continue
        d = json.loads(run("hc", "get", t["address"], "--json") or "{}")
        path = session_file(d, cache)
        if path:
            prs = scan(path, cache)[2]
            if prs:
                found[t["address"]] = prs
    # Only the session files this run looked at: the rest are sessions that ended.
    save({p: v for p, v in cache.items() if p in USED})
    live = {p for prs in found.values() for p in prs}
    info = states(sorted(live))
    if info is None:
        sys.exit("prs.py: GitHub didn't answer")
    json.dump({a: [info[p] for p in prs if p in info] for a, prs in found.items()}, sys.stdout)


if __name__ == "__main__":
    main()
