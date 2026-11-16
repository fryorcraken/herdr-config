// Changed from herdr's `agents` mod (Apache-2.0, https://github.com/herdrdev/herdr-app) by fryorcraken.
// The worktree test and space avatars follow herdr's `spaces` mod (same licence).
// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left. personal: grouped by space, worktree spaces
// nest under their main checkout's, as the Spaces list draws them.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, nextCommand, openOverlay, closeOverlay, props, window, layout, home, hc, notify, exec, appHome, checking } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Strip the spinner/status glyph agents put in front of their title (Claude Code: "✳ ", "⠂ "),
// i.e. leading symbols and spaces only. Punctuation such as "[", "(", "#" stays: a session
// named "[herdr] config" must keep its bracket. "~" stays so "~/src" still reads as a path.
const clean = (s) => (s ?? "").replace(/^(?:(?!~)[\p{S}\p{Z}\p{Co}\s\u00b7\u2022])+/u, "").replace(/^OC \| /, "").trim(); // personal: drop OpenCode's "OC | " prefix

// personal: the last folder of a path, "~" at home.
function where(cwd) {
  if (!cwd) return null;
  return cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop() ?? cwd;
}

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATUS_AT = { 4: "blocked", 3: "done", 2: "working", 1: "idle" };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Status", icon: "mods/workspace-chrome/clock.svg" },
  { id: "grouped", label: "Space", icon: "mods/workspace-chrome/layers.svg" },
];
// personal: how rows are ordered inside a group, apart from how they're grouped.
const ORDERS = [
  // Needs you, then done (unread), working, idle; ties in tab order. Worktrees follow the rows.
  { id: "status", label: "Status" },
  { id: "recent", label: "Recent activity" },
  { id: "tab", label: "Tab order" },
  // Picking it also puts each space's tabs in that order, once.
  { id: "alpha", label: "A to Z" },
];
// Case and punctuation aside, so "[RFP-012] Publish" sits next to "RFP-024 ...".
const alphaKey = (s) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
// "alpha" was briefly a grouping of its own, meaning by space, A to Z.
// personal: agents whose session takes "/rename <name>" (that name is what their resume list shows).
const RENAMES = new Set(["claude", "opencode"]);
const sortOf = () => SORTS.find((s) => s.id === (shared("agents.sort") === "alpha" ? "grouped" : shared("agents.sort"))) ?? SORTS[0];
// Unset: what each grouping did before there was a choice (status: recent first; space: tab order).
const orderOf = () => ORDERS.find((o) => o.id === (shared("my-agents.order") ?? (shared("agents.sort") === "alpha" ? "alpha" : sortOf().id === "priority" ? "recent" : "tab"))) ?? ORDERS.find((o) => o.id === "recent");
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// personal: the pull request badge. prs.py (next to this file) finds the PRs each Claude Code
// session opened and asks GitHub for their state; GitHub's own colors, the theme has none for this.
const PR_EVERY = 90000;
const PR_COLOR = { OPEN: "#3fb950", MERGED: "#a371f7", CLOSED: "#f85149" };
const PR_WORD = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };
const CHECKS_WORD = { SUCCESS: "checks pass", FAILURE: "checks fail", ERROR: "checks fail", PENDING: "checks running", EXPECTED: "checks waiting" };
// The PR a row shows: its newest open one, else its newest merged one, else its newest.
const mainPr = (prs) => { const r = [...prs].reverse(); return r.find((p) => p.state === "OPEN") ?? r.find((p) => p.state === "MERGED") ?? r[0]; };
const prLine = (p) => [`${p.repo}#${p.number}`, p.draft && p.state === "OPEN" ? "draft" : PR_WORD[p.state] ?? p.state.toLowerCase(), p.state === "OPEN" && CHECKS_WORD[p.checks], p.title].filter(Boolean).join(" · ");

// personal: worktree spaces go under their main checkout's space, as the Spaces list nests them.
// Where a space is now, as that list reads it: its first terminal's live folder, else where it
// was made; with its machine, so one path on two machines is two places. Null: nowhere yet.
function spotOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const at = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  return at ? JSON.stringify([s.machine ?? null, at]) : null;
}
const GIT_AT_ONCE = 4;
const WT_INDENT = 12; // px a worktree's rows sit right of its line
const GIT_RETRY = 60000; // a place git couldn't answer for (a machine away) is asked again after this

// personal: a space's avatar as the Spaces list draws it: its stored color, its first letter.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function avatar(t, id, name, size) {
  const c = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return h_flex().size(size).flex_none().rounded(4).bg(c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? MARK.ansi6))
    .items_center().justify_center().text_size(Math.round(size * 0.6)).font_bold().text_color("#ffffff")
    .child([...(name ?? "")][0]?.toUpperCase() ?? "?");
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.rename) return this.initRename(cx);
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    // Only a pick made from now on sorts the tabs, not the one remembered from last time.
    this.sortedTabsAt = shared("my-agents.sortTabsAt");
    cx.timer.every(30000, (cx) => cx.notify());
    this.prs = JSON.parse(localStorage.getItem("prs") ?? "{}");
    if (!checking()) {
      this.loadPrs(cx);
      cx.timer.every(PR_EVERY, (cx) => this.loadPrs(cx));
    }
    // personal: which repo each space's place is in (see families). Render lists the places it
    // has no answer for; this asks git. The last answer per space is kept across restarts, so
    // worktrees start nested; every place is asked again once all the same.
    this.git = {}; // place -> { repo, linked }, null: not a repo
    this.failed = {}; // place -> when git last couldn't answer
    this.wanted = new Set();
    try { this.lastGit = JSON.parse(localStorage.getItem("git") ?? "{}") ?? {}; } catch { this.lastGit = {}; }
    cx.timer.every(300, (cx) => this.lookGit(cx));
    // keys.json: "my-agents.next_blocked" / "my-agents.prev_blocked" jump between agents that
    // need you (blocked), in the order this list shows them, wrapping around.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "next_blocked" || c === "prev_blocked") this.jumpBlocked(c === "prev_blocked" ? -1 : 1);
        // keys.json: "my-agents.rename" renames what's focused, as a double click on its row does.
        if (c === "rename") {
          const f = focused();
          const a = this.rows?.get(f?.terminal);
          if (a) this.rename(a);
          else if (f?.tab) run("tab.rename", { id: f.tab });
        }
        cx.notify();
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  jumpBlocked(dir) {
    const list = agents();
    const blocked = new Set(list.filter((a) => a.status === "blocked").map((a) => a.address));
    if (!blocked.size) return;
    const order = (this.order ?? []).filter((a) => blocked.has(a));
    for (const a of blocked) if (!order.includes(a)) order.push(a);
    const i = order.indexOf(list.find((a) => a.focused)?.address);
    const next = order[i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length];
    const a = list.find((x) => x.address === next);
    if (a) run("pane.focus", { pane: a.pane });
  }

  // One run at a time: a slow GitHub shouldn't stack them up.
  loadPrs(cx) {
    if (this.prsLoading) return;
    this.prsLoading = true;
    exec("python3", ["-I", `${appHome()}/mods/my-agents/prs.py`], { timeout: 60000 })
      .then((r) => {
        if (r.code !== 0) return console.error("my-agents: prs.py", r.stderr.trim());
        this.prs = JSON.parse(r.stdout);
        localStorage.setItem("prs", r.stdout);
        cx.notify();
      })
      .catch((e) => console.error("my-agents: prs.py", String(e)))
      .finally(() => { this.prsLoading = false; });
  }

  // personal: asks git about the places render had no answer for, a few at a time, one round at a time.
  lookGit(cx) {
    if (this.gitLooking) return;
    const now = Date.now();
    const keys = [...this.wanted].filter((k) => !(k in this.git) && now - (this.failed[k] ?? 0) > GIT_RETRY);
    if (!keys.length) return;
    this.gitLooking = true;
    cx.spawn(async (cx) => {
      let next = 0;
      try {
        await Promise.all(Array.from({ length: Math.min(GIT_AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.checkGit(keys[next++]);
        }));
      } finally { this.gitLooking = false; }
      cx.notify();
    });
  }

  // The same two reads as the Spaces list: a worktree's top folder isn't where its repo's .git is.
  async checkGit(key) {
    const [on, cwd] = JSON.parse(key);
    try {
      const [top, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (top.code === 0 && common.code === 0) {
        const dir = top.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
        this.git[key] = { repo: JSON.stringify([on, repo]), linked: repo !== `${dir}/.git` };
        delete this.failed[key];
      } else if (/not a git repository/i.test(top.code !== 0 ? top.stderr : common.stderr)) this.git[key] = null;
      else this.failed[key] = Date.now();
    } catch {
      this.failed[key] = Date.now();
    }
  }

  // Space id -> the space whose header its rows go under: a worktree's, the first space that is its
  // repo's main checkout, as the Spaces list nests it; anything else, itself (a worktree too, while
  // its main checkout has no space). A place git hasn't answered for yet keeps the space's last answer.
  families(sp, ps) {
    const info = new Map(), live = new Set();
    let dirty = false;
    this.wanted = new Set();
    for (const s of sp) {
      const k = spotOf(s, ps);
      if (k) live.add(k);
      if (k && k in this.git) {
        const g = this.git[k];
        info.set(s.id, g);
        if (JSON.stringify(this.lastGit[s.id] ?? null) !== JSON.stringify(g)) { this.lastGit[s.id] = g; dirty = true; }
      } else {
        if (k) this.wanted.add(k);
        info.set(s.id, this.lastGit[s.id] ?? null);
      }
    }
    for (const k of Object.keys(this.git)) if (!live.has(k)) delete this.git[k];
    for (const k of Object.keys(this.failed)) if (!live.has(k)) delete this.failed[k];
    // No spaces at all is a layout still loading, not every space closed.
    const ids = new Set(sp.map((s) => s.id));
    if (ids.size) for (const id of Object.keys(this.lastGit)) if (!ids.has(id)) { delete this.lastGit[id]; dirty = true; }
    if (dirty) localStorage.setItem("git", JSON.stringify(this.lastGit));
    const mains = new Map();
    for (const s of sp) {
      const g = info.get(s.id);
      if (g && !g.linked && !mains.has(g.repo)) mains.set(g.repo, s.id);
    }
    return new Map(sp.map((s) => {
      const g = info.get(s.id);
      return [s.id, (g?.linked && mains.get(g.repo)) || s.id];
    }));
  }

  // The row's PR icon, colored by state; a red dot when an open PR's checks fail. Clicking opens it.
  prBadge(t, a) {
    const prs = this.prs?.[a.address];
    if (!prs?.length) return null;
    const p = mainPr(prs);
    const color = p.state === "OPEN" && p.draft ? t.dim : PR_COLOR[p.state] ?? t.dim;
    const failing = p.state === "OPEN" && (p.checks === "FAILURE" || p.checks === "ERROR");
    const others = prs.filter((x) => x !== p);
    return h_flex()
      .id(`pr-${a.address}`)
      .flex_none()
      .p(2)
      .gap(2)
      .rounded(4)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip([prLine(p), ...others.map(prLine)].join("\n"))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.open_url(p.url);
      })
      .child(svg("mods/my-agents/git-pull-request.svg").size(13).flex_none().text_color(color))
      .when(failing, (el) => el.child(div().size(5).flex_none().rounded(3).bg(PR_COLOR.CLOSED)))
      .when(others.length > 0, (el) => el.child(div().text_size(10).text_color(t.dim).child(`+${others.length}`)));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id, ord = orderOf().id;
    const head = (label) => div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child(label);
    const item = (id, label, icon, checked, pick) => h_flex()
      .id(id)
      .h(31)
      .px(8)
      .gap(9)
      .rounded(7)
      .items_center()
      .text_color(t.foreground)
      .hover((el) => el.bg(t.hover))
      .on_click(() => {
        pick();
        closeOverlay(props().overlay);
      })
      .child(icon ? svg(icon).size(14).flex_none().text_color(t.muted) : div().size(14).flex_none())
      .child(div().flex_1().child(label))
      .when(checked, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)));
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(head("Group by"))
      .children(SORTS.map((s) => item(`sort-${s.id}`, s.label, s.icon, s.id === on, () => setShared("agents.sort", s.id))))
      .child(head("Order"))
      .children(ORDERS.map((o) => item(`order-${o.id}`, o.label, null, o.id === ord, () => {
        setShared("my-agents.order", o.id);
        // The list view sorts the tabs when this changes, so picking A to Z again re-sorts them.
        if (o.id === "alpha") setShared("my-agents.sortTabsAt", Date.now());
      })));
  }

  // personal: renames what a row is. Claude Code and OpenCode get "/rename <name>" typed into
  // their session, so the name sticks to the session itself; anything else renames its tab.
  rename(a) {
    if (!RENAMES.has(a.program?.key)) return run("tab.rename", { id: a.tab });
    const now = clean(a.title);
    openOverlay({ mod: "my-agents", kind: "dialog", width: 420, height: 196,
      props: { rename: { address: a.address, program: a.program.name, value: now && now !== a.program.name ? now : "" } } });
  }

  initRename(cx) {
    this.text = props().rename.value ?? "";
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submitRename());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submitRename() {
    const p = props(), r = p.rename, name = this.text.trim();
    closeOverlay(p.overlay);
    if (!name) return;
    // Typed mid-turn it would land as a message; a blocked agent, hc refuses on its own.
    if (agents().find((x) => x.address === r.address)?.status === "working") {
      notify({ title: "Not renamed", body: `${r.program} is working. Rename it once it stops.`, level: "warning" });
      return;
    }
    hc(["send", r.address, `/rename ${name}`]).then((res) => {
      if (res.code !== 0) notify({ title: "Rename failed", body: (res.stderr || res.stdout).trim(), level: "error" });
    });
  }

  renameDialog(t) {
    const p = props();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(`Rename ${p.rename.program} session`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("rn-save", "Rename", true, () => this.submitRename())));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, indent = 0) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39 + indent)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.rename) return this.renameDialog(t);
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const real = agents();
    this.listed = new Map(real.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(real, now);
    this.hold(real);
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const paneList = panes();
    // personal: every terminal pane that isn't an agent (a shell, or an agent that exited and
    // left its shell) is listed too, so a pane doesn't drop out of the list between two agents.
    const sp = spaces();
    const place = new Map(sp.flatMap((s, si) => s.tabs.map((tb, ti) => [tb.id, { s, si, ti, tb }])));
    // personal: a worktree space's rows go under its main checkout's space (see families).
    const topOf = this.families(sp, paneList);
    const spaceBy = new Map(sp.map((s, i) => [s.id, { s, i }]));
    const topSpace = (a) => topOf.get(a.space) ?? a.space;
    const isAgent = new Set(real.map((a) => a.address));
    const pinnedT = new Set(all.filter((x) => x.labels?.["herdr.pinned"]).map((x) => x.address));
    const shells = paneList.filter((p) => p.terminal && !isAgent.has(p.terminal) && place.has(p.tab)).map((p) => {
      const { s, tb } = place.get(p.tab);
      return { address: p.terminal, pane: p.pane, space: s.id, space_name: s.name, tab: p.tab, tab_index: tb.index, tab_name: tb.name,
        status: null, app: null, program: p.program, title: p.title, seq: 0, pinned: pinnedT.has(p.terminal), focused: p.focused, shell: true, cwd: p.cwd };
    });
    // Space, tab, pane order, as agents() is, so a space's rows stay together. personal: by the
    // space a row goes under first, its own rows before its worktrees', so those stay together too.
    const paneAt = new Map(paneList.map((p, i) => [p.pane, i]));
    const pos = (a) => {
      const o = place.get(a.tab), top = topSpace(a);
      return [spaceBy.get(top)?.i ?? 1e9, top === a.space ? -1 : o?.si ?? 1e9, o?.ti ?? 1e9, paneAt.get(a.pane) ?? 1e9];
    };
    let list = [...real, ...shells].map((a) => [pos(a), a])
      .sort(([x], [y]) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]).map(([, a]) => a);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) if (!a.shell) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    // personal: a folded line's marker, as the sort sees its rows: sub-agents and a held done count.
    const topStatus = (members) => STATUS_AT[Math.max(0, ...members.map((a) => rankOf(a) || 0))] ?? null;

    // indent: personal, a worktree's rows sit a little right of its line (see checkouts).
    const withKids = (a, i, indent = 0) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs, indent);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority, indent))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const leads = leadPanes(paneList);
    const tabs = new Map([...place].map(([id, o]) => [id, o.tb]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      // personal: a shell reads as its tab's name if someone named it, else its folder.
      // Something other than the shell running in it (vim, a server) reads "<program> · <folder>".
      const dir = where(a.cwd), busy = a.program && !a.program.shell ? a.program.name : null;
      // A named tab's name only when the shell is alone in it, so split panes don't all read the same.
      const alone = paneList.filter((p) => p.tab === a.tab && p.terminal).length === 1;
      if (a.shell) return [a.address, tab?.named && alone ? tab.name : busy && dir ? `${busy} · ${dir}` : busy ?? dir ?? "shell"];
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }
    // The name a row shows under its space header.
    const shownName = (a) => detail.get(a.address) ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
    // personal: group first (status, or space in sidebar order), then the chosen order inside.
    const order = orderOf().id;
    // By status a row reads "space · detail", so that is what A to Z goes by.
    const keys = new Map(list.map((a) => [a.address, alphaKey(byPriority ? `${a.space_name} ${shownName(a)}` : shownName(a))]));
    const within = order === "alpha" ? (x, y) => { const p = keys.get(x.address), q = keys.get(y.address); return p < q ? -1 : p > q ? 1 : 0; }
      : order === "recent" ? (x, y) => this.since(y) - this.since(x) || y.seq - x.seq
      // Ties keep tab order, so one worktree's rows of a kind stay together.
      : order === "status" ? (x, y) => (rankOf(y) || RANK.idle) - (rankOf(x) || RANK.idle)
      : () => 0; // tab order: the list is in it already, and the sort keeps ties in place
    list = [...list].sort((x, y) => (byPriority ? (rankOf(y) || RANK.idle) - (rankOf(x) || RANK.idle) : pos(x)[0] - pos(y)[0]) || within(x, y));
    // personal: picking A to Z (a new stamp) puts each space's tabs in that order, once.
    const stamp = shared("my-agents.sortTabsAt");
    if (order === "alpha" && stamp && stamp !== this.sortedTabsAt) {
      this.sortedTabsAt = stamp;
      for (const s of spaces()) {
        const first = new Map();
        const named = list.filter((a) => a.space === s.id).map((a) => [a.tab, alphaKey(shownName(a))]).sort(([, p], [, q]) => (p < q ? -1 : p > q ? 1 : 0));
        for (const [tab, k] of named) if (!first.has(tab)) first.set(tab, k);
        // Tabs with no row (a mod only) keep their order after the others.
        const want = s.tabs.map((tb, i) => [first.get(tb.id) ?? "￿", i, tb.id])
          .sort(([k1, i1], [k2, i2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : i1 - i2)).map(([, , id]) => id);
        if (want.some((id, i) => id !== s.tabs[i].id)) want.forEach((id, i) => run("tab.move", { id, index: i + 1 }));
      }
    }
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));
    this.rows = new Map(list.map((a) => [a.address, a]));
    this.order = list.map((a) => a.address);

    const row = (a, i, subs = [], indent = 0) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = a.shell ? 0 : this.since(a);
      const idle = (a.status === "idle" || a.shell) && !a.focused;
      const isPinned = a.pinned;
      const pr = a.shell ? null : this.prBadge(t, a);
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .pl(8 + indent)
        .pr(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .on_mouse_down("left", (e) => { if (e.click_count === 2) this.rename(a); }) // personal: double click renames
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().id(`agent-name-${a.address}`).flex_1().min_w(0).gap(5).items_center()
          .tooltip(full && more ? `${name} · ${more}` : name) // personal: full name on hover
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(Boolean(pr), el => el.child(pr))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. The list is
    // sorted by space (personal: the one a row goes under) first, so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const top = byPriority ? null : topSpace(a);
      const id = byPriority ? `sec-${r}` : `sp-${top}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, top, label: byPriority ? SECTION[r] : spaceBy.get(top)?.s.name || a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // personal: under a space's header, rows from one of its worktrees go under a line naming it, the
    // way the Spaces list draws a worktree. The line follows the rows: whatever the order, each run
    // of one checkout's rows gets one, except the space's own rows when they come first. Its own
    // rows after a worktree's get a line with the space's avatar. A line folds that checkout's rows.
    const checkout = (g, run, n) => {
      const key = `wt-${run.space}`, open = !this.folded.has(key);
      const s = spaceBy.get(run.space)?.s, name = s?.name ?? run.members[0].space_name ?? "";
      const top = topStatus(run.members);
      return h_flex()
        .id(`${key}-${n}`)
        .px(8)
        .h(24)
        .flex_none()
        .gap(9)
        .items_center()
        .text_size(11.5)
        .font_medium()
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(key) : this.folded.delete(key);
          cx.notify();
        })
        // In the rows' icon column, so the name lines up with theirs.
        .child(h_flex().w(16).flex_none().justify_center()
          .child(run.space === g.top ? avatar(t, run.space, name, 13) : svg("mods/workspace-chrome/branch.svg").size(12).flex_none()))
        .child(div().min_w(0).truncate().child(name))
        .when(!open, (el) => el.child(div().child(String(run.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(Boolean(top) && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none()));
    };
    const checkouts = (g) => {
      const runs = [];
      for (const a of g.members) {
        if (runs.at(-1)?.space === a.space) runs.at(-1).members.push(a);
        else runs.push({ space: a.space, members: [a] });
      }
      // A worktree's rows sit a little right, under its line; the space's own stay put. The space's
      // own rows first need no line, unless they're folded: then the line is what shows it.
      return runs.flatMap((run, n) => {
        const own = run.space === g.top, folded = this.folded.has(`wt-${run.space}`);
        const rows = folded ? [] : run.members.flatMap((a, i) => withKids(a, i, own ? 0 : WT_INDENT));
        return n === 0 && own && !folded ? rows : [checkout(g, run, n), ...rows];
      });
    };

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = topStatus(g.members);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap((a, i) => withKids(a, i))
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.top ? checkouts(g) : g.members.flatMap((a, i) => withKids(a, i)))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "my-agents", kind: "popup", width: 200, height: 256, props: { sortMenu: true } }))
                .tooltip(`Group by ${sort.label.toLowerCase()}, ${orderOf().label.toLowerCase()}`)
                .child(svg(sort.icon).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
