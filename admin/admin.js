import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { STATUS, countByStatus, errorText, filterReports, fmtDate } from "./reports.js";

const $ = (s) => document.querySelector(s);
const views = { setup: $("#setup"), login: $("#login"), denied: $("#denied"), app: $("#app") };
const show = (v) => { for (const [k, el] of Object.entries(views)) el.hidden = k !== v; };
let reports = [];
let filter = { status: "all", query: "" };

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.dataset.bad = String(bad);
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3500);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  show("setup");
} else {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return show("login");
    $("#who").textContent = session.user.email ?? "";
    // Nur zur Anzeige – die eigentliche Sperre ist RLS in der Datenbank.
    const { data, error } = await sb.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
    if (error || !data) { $("#denied-who").textContent = session.user.email ?? ""; return show("denied"); }
    show("app");
    await load();
  }

  async function load() {
    $("#list").setAttribute("aria-busy", "true");
    const { data, error } = await sb.from("bug_reports").select("*").order("created_at", { ascending: false });
    $("#list").removeAttribute("aria-busy");
    if (error) return toast(errorText(error), true);
    reports = data;
    render();
  }

  function render() {
    const c = countByStatus(reports);
    for (const k of Object.keys(c)) $(`[data-count="${k}"]`).textContent = c[k];
    for (const b of document.querySelectorAll("[data-filter]")) b.setAttribute("aria-pressed", String(b.dataset.filter === filter.status));
    const rows = filterReports(reports, filter);
    const list = $("#list");
    list.replaceChildren();
    $("#empty").hidden = rows.length > 0;
    for (const r of rows) {
      const li = $("#tpl-report").content.firstElementChild.cloneNode(true);
      li.dataset.status = r.status;
      li.querySelector(".date").textContent = fmtDate(r.created_at);
      li.querySelector(".date").dateTime = r.created_at;
      li.querySelector(".meta").textContent = [r.app_version && `v${r.app_version}`, r.platform].filter(Boolean).join(" · ");
      li.querySelector(".desc").textContent = r.description; // textContent: kein HTML aus Berichten
      const sel = li.querySelector("select");
      sel.value = r.status;
      sel.setAttribute("aria-label", `Status des Berichts vom ${fmtDate(r.created_at)}`);
      sel.addEventListener("change", () => void setStatus(r, sel.value, sel));
      li.querySelector(".del").addEventListener("click", () => void remove(r));
      list.append(li);
    }
  }

  async function setStatus(r, status, sel) {
    const prev = r.status;
    r.status = status;
    render();
    const { error } = await sb.from("bug_reports").update({ status }).eq("id", r.id);
    if (error) { r.status = prev; sel.value = prev; render(); return toast(errorText(error), true); }
    toast(`Status: ${STATUS[status]}`);
  }

  async function remove(r) {
    if (!confirm("Diesen Bericht endgültig löschen?")) return;
    const { error, count } = await sb.from("bug_reports").delete({ count: "exact" }).eq("id", r.id);
    if (error || count === 0) return toast(error ? errorText(error) : "Keine Berechtigung.", true);
    reports = reports.filter((x) => x.id !== r.id);
    render();
    toast("Bericht gelöscht");
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget; // nach await ist currentTarget null
    const f = new FormData(form);
    const btn = $("#login-btn");
    btn.disabled = true;
    $("#login-error").hidden = true;
    const fail = (err) => { $("#login-error").textContent = errorText(err); $("#login-error").hidden = false; };
    try {
      const { error } = await sb.auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
      if (error) return fail(error);
      form.reset();
      await route();
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  });
  for (const b of document.querySelectorAll(".logout")) b.addEventListener("click", async () => { await sb.auth.signOut(); show("login"); });
  $("#reload").addEventListener("click", () => void load());
  $("#search").addEventListener("input", (e) => { filter.query = e.target.value; render(); });
  for (const b of document.querySelectorAll("[data-filter]")) b.addEventListener("click", () => { filter.status = b.dataset.filter; render(); });
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") show("login"); });
  void route().catch((e) => toast(errorText(e), true));
}
