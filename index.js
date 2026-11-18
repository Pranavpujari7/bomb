(() => {
  // after ANY edit change "hash" in manifest.json. Keep this file starting with the ( ) => expression.
  const state = { unpatches: [] };
  return {
  onLoad() {
    const URL_BASE = "http://127.0.0.1:8765";
    const AUTO = true;
    const LONG_PRESS = true;
    const OUTPUT = "message";
    const AUTO_MANUAL = false;
    const { before, after } = vendetta.patcher;
    const { findByProps, findByStoreName } = vendetta.metro;
    const { React, FluxDispatcher } = vendetta.metro.common;
    const { showToast } = vendetta.ui.toasts;
    const { showConfirmationAlert } = vendetta.ui.alerts;
    state.unpatches = [];
    const seen = new Set();
    let busy = false;
    const imageOf = (m) => {
      if (!m) return null;
      for (const a of m.attachments || []) {
        const ct = String(a.content_type || a.contentType || "");
        const fn = String(a.filename || "").toLowerCase();
        if (ct.startsWith("image") || /\.(png|jpe?g|webp|gif)$/.test(fn)) return a.url || a.proxy_url || a.proxyURL;
      }
      for (const e of m.embeds || []) {
        for (const p of [e.image, e.thumbnail]) {
          if (p && (p.url || p.proxyURL || p.proxy_url)) return p.proxyURL || p.proxy_url || p.url;
        }
      }
      return null;
    };
    const show = (title, text, channelId) => {
      if (OUTPUT === "message") {
        try {
          const mu = findByProps("sendBotMessage");
          const ch = channelId || findByStoreName("SelectedChannelStore").getChannelId();
          if (mu && mu.sendBotMessage && ch) {
            mu.sendBotMessage(ch, "\u200b" + text);
            return;
          }
        } catch (e) {}
      }
      showConfirmationAlert({ title, content: text, confirmText: "OK", onConfirm: () => {} });
    };
    const copyText = (t) => {
      try {
        const c = (vendetta.metro.common && vendetta.metro.common.clipboard) || findByProps("setString");
        if (c && c.setString) c.setString(String(t));
      } catch (e) {}
    };
    const textOf = (m) => {
      const parts = [m.content || ""];
      for (const e of m.embeds || []) {
        parts.push(e.rawTitle || e.title || "", e.rawDescription || e.description || "");
        for (const f of e.fields || []) parts.push((f.rawName || f.name || "") + "\n" + (f.rawValue || f.value || ""));
      }
      return parts.filter(Boolean).join("\n");
    };
    const saveManual = async (text, urls, silentIfUnknown, channelId) => {
      try {
        const me = findByStoreName("UserStore").getCurrentUser();
        const r = await fetch(URL_BASE + "/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, urls: urls || [], user: me.id }),
        });
        const j = await r.json();
        if (!j.found && silentIfUnknown) return;
        show(j.found ? "Manual saved" : "Not saved", j.text, channelId);
      } catch (e) {
        showToast("Bot not reachable - is it running in Termux?");
      }
    };
    state.saveManual = saveManual;
    const solveAll = async (startMessage, channelId) => {
      if (busy) return;
      busy = true;
      showToast("Solving all...");
      try {
        const me = findByStoreName("UserStore").getCurrentUser();
        const ch = channelId || findByStoreName("SelectedChannelStore").getChannelId();
        const col = findByStoreName("MessageStore").getMessages(ch);
        const arr = (col && (col.toArray ? col.toArray() : col._array)) || [];
        let from = arr.findIndex((x) => x.id === startMessage.id);
        const list = from >= 0 ? arr.slice(from) : arr.slice(-30);
        const items = [];
        for (const m of list) {
          if (String(m.content || "").charCodeAt(0) === 0x200b) continue;
          if (!(Number(m.flags || 0) & 64) && !(m.author && m.author.bot)) continue;
          const url = imageOf(m);
          if (!url) continue;
          items.push({ id: m.id, text: textOf(m), url });
        }
        const r = await fetch(URL_BASE + "/solveall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: me.id, items }),
        });
        const j = await r.json();
        if (j.copy && j.copied === false) copyText(j.copy);
        show("Answers", j.text, ch);
      } catch (e) {
        showToast("Bot not reachable - is it running in Termux?");
      } finally {
        busy = false;
      }
    };
    const imagesOf = (m) => {
      const out = [];
      const add = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
      for (const a of (m && m.attachments) || []) {
        const ct = String(a.content_type || a.contentType || "");
        const fn = String(a.filename || "").toLowerCase();
        if (ct.startsWith("image") || /\.(png|jpe?g|webp|gif)$/.test(fn)) add(a.url || a.proxy_url || a.proxyURL);
      }
      for (const e of (m && m.embeds) || []) {
        for (const p of [e.image, e.thumbnail]) if (p) add(p.proxyURL || p.proxy_url || p.url);
      }
      return out;
    };
    const solve = async (url, channelId) => {
      if (busy) return;
      busy = true;
      showToast("Solving...");
      try {
        const me = findByStoreName("UserStore").getCurrentUser();
        const r = await fetch(URL_BASE + "/solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, user: me.id }),
        });
        const j = await r.json();
        if (j.copy && j.copied === false) copyText(j.copy);
        show("Answer", j.text, channelId);
      } catch (e) {
        showToast("Bot not reachable - is it running in Termux?");
      } finally {
        busy = false;
      }
    };
    state.solve = solve;
    if (AUTO) {
      const onMsg = (ev) => {
        const m = ev && ev.message;
        if (!m || !(Number(m.flags || 0) & 64)) return;
        if (String(m.content || "").charCodeAt(0) === 0x200b) return;
        const chId = m.channel_id || m.channelId || ev.channelId;
        const url = imageOf(m);
        if (!url) {
          if (AUTO_MANUAL) {
            const txt = textOf(m);
            const k2 = m.id + "|t|" + txt.length;
            if (txt && !seen.has(k2)) { seen.add(k2); saveManual(txt, [], true, chId); }
          }
          return;
        }
        const key = m.id + "|" + String(url).split("?")[0];
        if (seen.has(key)) return;
        seen.add(key);
        solve(url, chId);
      };
      FluxDispatcher.subscribe("MESSAGE_CREATE", onMsg);
      FluxDispatcher.subscribe("MESSAGE_UPDATE", onMsg);
      state.unpatches.push(() => {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMsg);
      });
    }
    if (LONG_PRESS) {
      try {
        const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
        const Rows = findByProps("ActionSheetRow");
        const { findInReactTree } = vendetta.utils;
        state.unpatches.push(
          before("openLazy", LazyActionSheet, ([component, key, msg]) => {
            const message = msg && msg.message;
            if (key !== "MessageLongPressActionSheet" || !message) return;
            const url = imageOf(message);
            const urls = imagesOf(message);
            const txt = textOf(message);
            if (!url && !txt) return;
            const chId = message.channel_id || message.channelId;
            component.then((instance) => {
              const un = after("default", instance, (_, res) => {
                React.useEffect(() => () => { un(); }, []);
                const rows = findInReactTree(res, (x) => Array.isArray(x) && x[0] && x[0].props && x[0].props.onPress);
                if (!rows) return;
                if (rows.some((r) => r && r.key && String(r.key).indexOf("defuse-") === 0)) return;
                const row = (k, label, fn) =>
                  React.createElement(Rows.ActionSheetRow, {
                    key: "defuse-" + k,
                    label,
                    onPress: () => { LazyActionSheet.hideActionSheet(); fn(); },
                  });
                const mine = [];
                if (url) mine.push(row("solve", "Solve module", () => solve(url, chId)));
                mine.push(row("manual", "Save manual", () => saveManual(txt, urls, false, chId)));
                mine.push(row("all", "Solve all", () => solveAll(message, chId)));
                rows.unshift(...mine);
              });
            });
          })
        );
      } catch (e) {
        showToast("Long-press row not available on this version (AUTO still works)");
      }
    }
  },
  onUnload() {
    for (const u of state.unpatches || []) {
      try { u(); } catch (e) {}
    }
  },
  };
})()
          
