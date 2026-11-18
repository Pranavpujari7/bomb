(() => {
  // Defuse Link - Kettu/Vendetta plugin (plain JS, no build step).
  // Needs the bot (d42.py or newer) running on THIS phone: it listens on 127.0.0.1:8765.
  // NOTE for editors: Kettu evaluates the file as  vendetta=>{return <file>}  so the file must START with the expression (no comment
  // lines before it: "return" + newline would return undefined), and it must not rely on `this`. After ANY change of this file
  // change "hash" in manifest.json too, otherwise Kettu thinks nothing changed and does not download it again.
  const state = { unpatches: [] };
  return {
  onLoad() {
    // ---------- settings ----------
    const URL_BASE = "http://127.0.0.1:8765";
    const AUTO = true;        // true: every NEW ephemeral message that contains a picture is sent to the bot by itself
    const LONG_PRESS = true;  // true: long-press menu gets "Solve module" (message has a picture) and "Save as manual" (message has text)
    const AUTO_MANUAL = false; // true: every NEW ephemeral message with text is offered to the bot as a manual; it only reacts
                               // (popup) when it recognises a text manual in it. Risky: a later message can overwrite a saved manual.

    const { before, after } = vendetta.patcher;
    const { findByProps, findByStoreName } = vendetta.metro;
    const { React, FluxDispatcher } = vendetta.metro.common;
    const { showToast } = vendetta.ui.toasts;
    const { showConfirmationAlert } = vendetta.ui.alerts;
    state.unpatches = [];
    const seen = new Set();
    let busy = false;

    // ---------- helpers ----------
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

    const textOf = (m) => {
      const parts = [m.content || ""];
      for (const e of m.embeds || []) {
        parts.push(e.rawTitle || e.title || "", e.rawDescription || e.description || "");
        for (const f of e.fields || []) parts.push((f.rawName || f.name || "") + "\n" + (f.rawValue || f.value || ""));
      }
      return parts.filter(Boolean).join("\n");
    };

    const saveManual = async (text, silentIfUnknown) => {
      try {
        const me = findByStoreName("UserStore").getCurrentUser();
        const r = await fetch(URL_BASE + "/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, user: me.id }),
        });
        const j = await r.json();
        if (!j.found && silentIfUnknown) return;
        showConfirmationAlert({ title: j.found ? "Manual saved" : "Not saved", content: j.text, confirmText: "OK", onConfirm: () => {} });
      } catch (e) {
        showToast("Bot not reachable - is it running in Termux?");
      }
    };
    state.saveManual = saveManual;

    const solve = async (url) => {
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
        showConfirmationAlert({
          title: "Answer",
          content: j.text,
          confirmText: "OK",
          onConfirm: () => {},
        });
      } catch (e) {
        showToast("Bot not reachable - is it running in Termux?");
      } finally {
        busy = false;
      }
    };
    state.solve = solve;

    // ---------- AUTO: new ephemeral message with a picture ----------
    if (AUTO) {
      const onMsg = (ev) => {
        const m = ev && ev.message;
        if (!m || !(Number(m.flags || 0) & 64)) return; // 64 = ephemeral ("only you can see this")
        const url = imageOf(m);
        if (!url) {
          if (AUTO_MANUAL) {
            const txt = textOf(m);
            const k2 = m.id + "|t|" + txt.length;
            if (txt && !seen.has(k2)) { seen.add(k2); saveManual(txt, true); }
          }
          return;
        }
        const key = m.id + "|" + String(url).split("?")[0];
        if (seen.has(key)) return;
        seen.add(key);
        solve(url);
      };
      FluxDispatcher.subscribe("MESSAGE_CREATE", onMsg);
      FluxDispatcher.subscribe("MESSAGE_UPDATE", onMsg);
      state.unpatches.push(() => {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMsg);
      });
    }

    // ---------- LONG PRESS: extra row in the message menu (version dependent, wrapped in try) ----------
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
            const txt = textOf(message);
            if (!url && !txt) return;
            component.then((instance) => {
              const un = after("default", instance, (_, res) => {
                React.useEffect(() => () => { un(); }, []);
                const rows = findInReactTree(res, (x) => Array.isArray(x) && x[0] && x[0].props && x[0].props.onPress);
                if (!rows) return;
                if (txt) {
                  rows.unshift(
                    React.createElement(Rows.ActionSheetRow, {
                      key: "defuse-manual",
                      label: "Save as manual",
                      onPress: () => { LazyActionSheet.hideActionSheet(); saveManual(txt, false); },
                    })
                  );
                }
                if (url) {
                  rows.unshift(
                    React.createElement(Rows.ActionSheetRow, {
                      key: "defuse-solve",
                      label: "Solve module",
                      onPress: () => { LazyActionSheet.hideActionSheet(); solve(url); },
                    })
                  );
                }
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
