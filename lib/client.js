window.__ModuleLoader__.load({
  id: "dsh-compact-line",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");

    /**
     * 浏览器端：设置卡片上的压缩线面板 + 输入框下方的压缩线读数。
     *
     * 这个文件是手写的、不经任何打包器的等价产物 —— 宿主只要求 client bundle
     * 满足一个契约：执行时调用 window.__ModuleLoader__.load，导出一个带
     * apply/inject/name 的模块。
     *
     * inject 必须声明 "slots"。这不是可选的：宿主按 inject 列表决定给 apply 的
     * ctx 上挂哪些服务，没声明就拿不到 ctx.slots（它是 undefined 而不是一个空
     * 实现）。之前这里是 []，于是 apply 里第一次 ctx.slots.inject 就抛
     * TypeError，而那个 try/catch 把它吞成了一条没人会看的 console.error ——
     * 卡片安静地不出现。参考实现也印证同一条纪律：官方的 1017 徽标与
     * dsh-connect-workbuddy 都声明了 ["slots", ...]。
     */

    const h = react.createElement;
    const useState = react.useState;
    const useEffect = react.useEffect;
    const useCallback = react.useCallback;
    const useMemo = react.useMemo;
    const useRef = react.useRef;

    const STATE_PATH = "/plugins/dsh-compact-line/state";
    const APPLY_PATH = "/plugins/dsh-compact-line/apply";
    const RESET_PATH = "/plugins/dsh-compact-line/reset";

    /** 卡片在插件页里的两处挂载键；与宿主自带的查找口径一致。 */
    const CARD_KEYS = ["dsh-compact-line", "include:dsh-compact-line"];

    /** 输入框下方那排环境读数里的座位；order 12 排在宿主自带读数之后。 */
    const DOCK_SLOT = "conversation.composer.dock";
    const DOCK_ID = "dsh-compact-line-dock";
    const DOCK_ORDER = 12;

    // 没有档位表了。原先的下拉框给的是 128K/200K/…/500K 五个快捷值，可是既然
    // 用户要的是「填多少就是多少」，那么一个只有五个候选的选择器就是个谎言：
    // 它让 250000 这种真实存在的值只能以「自定义」出现，而「自定义」这个词
    // 本身又什么信息都不提供。一个数字输入框就是全部。
    //
    // 保留量也从界面上去掉了 —— 插件不再写 retain*，压缩后留多少由上游按它
    // 自己的比例决定。所以这里没有 RETAIN_CHOICES。

    const STYLE_ID = "dsh-compact-line-styles";

    const CSS = [
      ".dcl-root{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary,CanvasText)}",
      ".dcl-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".dcl-label{min-width:96px;color:var(--dsw-alias-label-secondary,inherit);opacity:.85}",
      ".dcl-input{font:inherit;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.35));background:transparent;color:inherit}",
      ".dcl-input{width:112px}",
      ".dcl-button{font:inherit;padding:5px 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.35));background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:inherit}",
      ".dcl-button:disabled{opacity:.5;cursor:default}",
      ".dcl-hint{font-size:12px;opacity:.72;line-height:1.6}",
      ".dcl-error{color:var(--dsw-alias-status-danger,#d33);font-size:12px}",
      ".dcl-ok{color:var(--dsw-alias-status-success,#3ba55d);font-size:12px}",
      ".dcl-table{width:100%;border-collapse:collapse;font-size:12px}",
      ".dcl-table th,.dcl-table td{text-align:left;padding:4px 8px 4px 0;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.18))}",
      ".dcl-num{font-variant-numeric:tabular-nums}",
      // 照抄 ui-chat 的 StatsPills —— 也就是左边「13 轮 360 步 · 200 tok/s」和
      // 「52.9M tok · 缓存命中 99%」那两块读数本身，不是我上一版参照的
      // ContextMeter（那个是 12% 圆环）。
      //
      // 两处差别是上一次「大一号」的全部原因：
      //   1. StatsPills 的 anchor 把字号再减 1px：calc(...secondary,13px) - 1px。
      //      这一行里最显眼的文字（轮次/步数/token）是 12px，不是 13px。
      //   2. 字号必须显式写死 var(...)：dock 容器没设字号，inherit 拿到的是浏览器
      //      默认 16px —— 那才是第一版「明显大一圈」的根源。
      //
      // hover 浮出圆角底色 + 文字提亮是这一行的既有语言（StatsPills 与
      // ContextMeter 都如此），沿用它，不发明下划线之类的新花样。
      // position:relative 不能省：弹层是相对这个 anchor 定位的（StatsPills 用
      // portal 不需要它，但我们不走 portal，少一个容器就少一处对不齐）。
      ".dcl-anchor{position:relative;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}",
      ".dcl-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}",
      ".dcl-pill:hover,.dcl-pill[data-open=\"1\"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dcl-pop{position:absolute;left:0;bottom:calc(100% + 8px);z-index:1100;box-sizing:border-box;width:440px;max-width:calc(100vw - 24px);padding:12px;border-radius:var(--dsw-radius-lg);border:0;background:var(--dsw-specific-menu,Canvas);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;text-align:left}",
      ".dcl-pop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}",
      ".dcl-pop-title{font-weight:600}",
      ".dcl-close{border:0;background:transparent;color:inherit;cursor:pointer;font-size:16px;line-height:1;opacity:.6;padding:2px 4px}",
      ".dcl-close:hover{opacity:1}"
    ].join("");

    function ensureStyles() {
      if (typeof document === "undefined") return undefined;
      if (document.getElementById(STYLE_ID) !== null) return undefined;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        const node = document.getElementById(STYLE_ID);
        if (node !== null) node.remove();
      };
    }

    function readJson(response) {
      return response.text().then((text) => {
        if (text.length === 0) return {};
        try {
          return JSON.parse(text);
        } catch (error) {
          return { error: text };
        }
      });
    }

    /**
     * 250000 -> "25万"，256000 -> "25.6万"。
     *
     * 一万以上才换算：更小的数字用「万」会得到 0.5万 这种反而不直观的写法，
     * 不如原样分段。小数位只留一位 —— 四舍五入到 0.1万（=1000 tokens）已经比
     * 压缩线本身的精度更细，再多就是假精确。整数万不补 .0。
     */
    function formatTokens(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      if (value >= 10000) {
        const rounded = Math.round(value / 1000) / 10;
        return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "万";
      }
      return value.toLocaleString();
    }

    /**
     * 从 /state 里读出「现在这块面板该显示什么」。
     *
     * 优先级：插件上次写入的记录 > 预设里真实的比例（比例 × 参考窗口只在两者
     * 都有时才可信）。都没有就如实说「默认」，不编一个数字出来。
     */
    function summarize(state) {
      if (state === undefined) return { label: "读取中", detail: "正在读取当前配置" };
      if (state.error !== undefined) return { label: "读取失败", detail: String(state.error) };
      const presets = Array.isArray(state.presets) ? state.presets : [];
      const live = presets.filter((preset) => preset.present === true);
      const applied = state.lastApplied;
      if (applied !== undefined && applied.plan !== undefined && typeof applied.plan.thresholdTokens === "number") {
        return {
          label: formatTokens(applied.plan.thresholdTokens),
          detail: "上次写入 " + applied.plan.thresholdTokens + " tokens，覆盖 " + live.length + " 个预设"
        };
      }
      if (live.length === 0) return { label: "无预设", detail: "没有读到任何 Agent 预设" };
      if (live.every((preset) => preset.thresholdRatio === undefined)) {
        return { label: "默认", detail: "压缩线仍跟随 DSH 自带配置" };
      }
      const ratios = live.map((preset) => preset.thresholdRatio);
      const same = ratios.every((ratio) => ratio === ratios[0]);
      // 拿得到参考窗口、且各预设比例一致时，把它折算回绝对 token 数。
      // 这样重启后（lastApplied 已清空）胶囊仍然显示「25万」而不是「比例 0.25」。
      // 窗口读不到就老实显示比例 —— 用兜底窗口折算会得到一个很像、其实不对的数。
      const window = state.referenceWindow;
      if (same && typeof window === "number" && Number.isFinite(window) && window > 0) {
        return {
          label: formatTokens(Math.round(ratios[0] * window)),
          detail: "由预设比例 × 参考窗口 " + window + " 折算；点开面板应用一次即写入"
        };
      }
      return {
        label: "比例 " + (same ? String(ratios[0]) : "每模型不同"),
        detail: "这是预设里此刻真实生效的比例；应用一次后这里会记回绝对值"
      };
    }

    /** 面板与胶囊共用的表单：压缩线 + 保留量 + 三个动作按钮。 */
    function CompactLineForm(props) {
      const state = props.state;
      const onChanged = props.onChanged;

      const [threshold, setThreshold] = useState(256000);
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState(undefined);
      const [failure, setFailure] = useState(undefined);
      const [touched, setTouched] = useState(false);

      // 表单初值取磁盘上的真实值，而不是插件内置默认值 —— 否则打开面板
      // 会把用户之前设的值悄悄改回 256K。用户一旦自己动过（touched），
      // 后续的刷新就不再覆盖他正在编辑的内容。
      useEffect(() => {
        if (touched || state === undefined) return;
        if (state.lastApplied !== undefined && state.lastApplied.plan !== undefined) {
          const applied = state.lastApplied.plan.thresholdTokens;
          if (typeof applied === "number") setThreshold(applied);
        }
      }, [state, touched]);

      const submit = useCallback(() => {
        setBusy(true);
        setFailure(undefined);
        setMessage(undefined);
        return fetch(APPLY_PATH, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ thresholdTokens: threshold })
        })
          .then(readJson)
          .then((payload) => {
            if (payload.ok === true) {
              const names = Array.isArray(payload.changed) ? payload.changed.map((item) => item.presetId).join("、") : "";
              const warnings = Array.isArray(payload.warnings) && payload.warnings.length > 0 ? "；" + payload.warnings.join("；") : "";
              setMessage("已写入 " + names + "，压缩线 " + payload.plan.thresholdTokens + warnings);
              setTouched(false);
              if (onChanged !== undefined) onChanged();
              return undefined;
            }
            setFailure(payload.reason !== undefined ? payload.reason : "写入失败");
            return undefined;
          })
          .catch((error) => {
            setFailure("写入失败：" + String(error));
          })
          .then(() => {
            setBusy(false);
          });
      }, [threshold, onChanged]);

      const reset = useCallback(() => {
        setBusy(true);
        setFailure(undefined);
        setMessage(undefined);
        return fetch(RESET_PATH, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })
          .then(readJson)
          .then((payload) => {
            if (payload.ok === true) {
              setMessage("已恢复 " + (payload.restored || []).join("、") + " 的宿主默认");
              setTouched(false);
              if (onChanged !== undefined) onChanged();
              return undefined;
            }
            setFailure(payload.reason !== undefined ? payload.reason : "恢复失败");
            return undefined;
          })
          .catch((error) => {
            setFailure("恢复失败：" + String(error));
          })
          .then(() => {
            setBusy(false);
          });
      }, [onChanged]);

      const touch = (setter) => (event) => {
        setTouched(true);
        setter(Number(event.target.value));
      };

      return h(
        "div",
        { className: "dcl-root" },
        h(
          "div",
          { className: "dcl-row" },
          h("span", { className: "dcl-label" }, "压缩线"),
          h("input", {
            className: "dcl-input",
            type: "number",
            min: 1000,
            step: 1000,
            value: threshold,
            disabled: busy,
            "aria-label": "压缩线（tokens）",
            onChange: touch(setThreshold)
          }),
          h("span", { className: "dcl-hint" }, "tokens")
        ),
        h(
          "div",
          { className: "dcl-hint" },
          "压到这条线就压缩一次，压完保留多少由 DSH 用默认比例",
          h("b", null, " retainRatio 0.16 "),
          "自己算 —— 这里不接管。"
        ),
        h(
          "div",
          { className: "dcl-row" },
          h("button", { className: "dcl-button", type: "button", onClick: submit, disabled: busy }, busy ? "写入中…" : "应用"),
          h("button", { className: "dcl-button", type: "button", onClick: props.onRefresh, disabled: busy }, "刷新"),
          h("button", { className: "dcl-button", type: "button", onClick: reset, disabled: busy }, "恢复默认")
        ),
        message !== undefined ? h("div", { className: "dcl-ok" }, message) : null,
        failure !== undefined ? h("div", { className: "dcl-error" }, failure) : null
      );
    }

    function useCompactionState() {
      const [state, setState] = useState(undefined);
      const alive = useRef(true);
      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      const refresh = useCallback(() => {
        return fetch(STATE_PATH, { credentials: "same-origin" })
          .then(readJson)
          .then((payload) => {
            if (alive.current) setState(payload);
          })
          .catch((error) => {
            if (alive.current) setState({ error: String(error) });
          });
      }, []);
      useEffect(() => {
        refresh();
      }, [refresh]);
      return [state, refresh];
    }

    /** 插件页上的配置卡片。 */
    function CompactLineCard() {
      useEffect(ensureStyles, []);
      const [state, refresh] = useCompactionState();

      const presets = state !== undefined && Array.isArray(state.presets) ? state.presets : [];
      const referenceWindow =
        state !== undefined && state.lastApplied !== undefined && state.lastApplied.plan !== undefined
          ? state.lastApplied.plan.referenceWindow
          : undefined;

      const rows = useMemo(() => {
        return presets.map((preset) => {
          const ratio = preset.thresholdRatio;
          const implied = typeof ratio === "number" && typeof referenceWindow === "number" ? Math.floor(ratio * referenceWindow) : undefined;
          return { preset: preset, implied: implied };
        });
      }, [presets, referenceWindow]);

      return h(
        "div",
        { className: "dcl-root" },
        h(
          "div",
          { className: "dcl-hint" },
          "DSH 的压缩线是按",
          h("b", null, "比例"),
          "配置的，分母是每个模型自己的窗口。这里填的是",
          h("b", null, "绝对 token 数"),
          "，插件负责换算成每个模型各自的比例，并对窗口较小的模型单独兜底。"
        ),
        h(CompactLineForm, { state: state, onRefresh: refresh, onChanged: refresh }),
        h(
          "table",
          { className: "dcl-table" },
          h("thead", null, h("tr", null, h("th", null, "预设"), h("th", null, "比例"), h("th", null, "折算"), h("th", null, "模型覆盖"))),
          h(
            "tbody",
            null,
            rows.map((row) =>
              h(
                "tr",
                { key: row.preset.presetId },
                h("td", null, row.preset.presetId),
                h("td", { className: "dcl-num" }, row.preset.present === true ? String(row.preset.thresholdRatio) : "—"),
                h("td", { className: "dcl-num" }, row.preset.present === true && row.implied !== undefined ? row.implied.toLocaleString() : "—"),
                h("td", { className: "dcl-num" }, row.preset.present === true ? row.preset.policyCount : "—")
              )
            ),
            rows.length === 0 ? h("tr", null, h("td", { colSpan: 4, className: "dcl-hint" }, "没有读到任何 Agent 预设")) : null
          )
        ),
        h(
          "div",
          { className: "dcl-hint" },
          "「折算」= 比例 × 参考窗口，用来核对这个比例实际对应多少 token。写入后由 Loader 热更新，",
          h("b", null, "已经开始的会话要等下一轮"),
          "才用上新阈值。「恢复默认」会删掉 profile 层对预设的覆盖，让它重新跟随 DSH —— 升级 DSH 前建议先点一次，否则新版本预设里的插件不会出现。"
        )
      );
    }

    /**
     * 输入框下方那排环境读数里的压缩线胶囊。
     *
     * 为什么放在 conversation.composer.dock 而不是输入框工具栏：那一行里有
     * 「完全权限」这种用户正在瞄准的控件，塞一个能点开面板的东西进去会抢点击
     * （dsh-connect-workbuddy 的 issue #71 就是同一个教训）。dock 这一行本来就
     * 是轮次 / 步数 / token / 上下文占用这些「会话数字」的座位，压缩线是同一类
     * 事实，放在这里不打搅任何操作。
     */
    function CompactionPill() {
      useEffect(ensureStyles, []);
      const [state, refresh] = useCompactionState();
      const [open, setOpen] = useState(false);
      const anchor = useRef(null);
      const summary = summarize(state);

      useEffect(() => {
        if (!open || typeof document === "undefined") return undefined;
        const onDown = (event) => {
          const node = anchor.current;
          if (node === null || node === undefined) return;
          if (typeof node.contains === "function" && node.contains(event.target)) return;
          setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [open]);

      useEffect(() => {
        if (!open) return undefined;
        refresh();
        if (typeof document === "undefined") return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
      }, [open, refresh]);

      return h(
        "span",
        { className: "dcl-anchor", ref: anchor },
        h(
          "button",
          {
            className: "dcl-pill",
            type: "button",
            title: "压缩线：" + summary.detail + "（点击调整）",
            "data-open": open ? "1" : "0",
            onClick: () => setOpen(!open)
          },
          "压缩线 " + summary.label
        ),
        open
          ? h(
              "div",
              { className: "dcl-pop", role: "dialog", "aria-label": "压缩线设置" },
              h(
                "div",
                { className: "dcl-pop-head" },
                h("span", { className: "dcl-pop-title" }, "压缩线"),
                h("button", { className: "dcl-close", type: "button", onClick: () => setOpen(false), "aria-label": "关闭" }, "×")
              ),
              h("div", { className: "dcl-hint", style: { marginBottom: "10px" } }, summary.detail),
              h(CompactLineForm, { state: state, onRefresh: refresh, onChanged: refresh })
            )
          : null
      );
    }

    /**
     * 注册两处：插件页的配置卡片，和输入框下方的读数胶囊。
     *
     * 卡片按每个可能的包名各注册一份 —— 插件页用「安装行的包名」做精确匹配去
     * 找配置，部署时把它改名成什么都有可能，而 key 不匹配的表现是页面空白、
     * 没有任何报错（dsh-connect-workbuddy 的 issue #55 就是这个坑）。
     */
    function apply(ctx) {
      const disposers = [];

      const registerCard = (slotName, key) => {
        try {
          const dispose = ctx.slots.inject(slotName, () =>
            ctx.slots.register(
              {
                name: slotName,
                key: key,
                priority: 30,
                inject: () => ({})
              },
              CompactLineCard
            )
          );
          if (typeof dispose === "function") disposers.push(dispose);
        } catch (error) {
          console.error('[dsh-compact-line] 卡片槽位 "' + slotName + '" key "' + key + '" 注册失败：', error);
        }
      };

      for (const key of CARD_KEYS) {
        registerCard("plugins.bundle.config", key);
        registerCard("plugins.row.config", key + "#" + key);
      }

      try {
        const dispose = ctx.slots.inject(DOCK_SLOT, () =>
          ctx.slots.register(
            {
              name: DOCK_SLOT,
              id: DOCK_ID,
              order: DOCK_ORDER,
              inject: () => ({})
            },
            CompactionPill
          )
        );
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (error) {
        console.error("[dsh-compact-line] 压缩线读数胶囊注册失败：", error);
      }

      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (error) {
            console.error("[dsh-compact-line] 槽位释放失败：", error);
          }
        }
      };
    }

    exports.apply = apply;
    /**
     * "slots" 是硬依赖，不是可有可无的声明。
     *
     * 宿主按这张表决定给 apply 的 ctx 挂哪些服务：没列进去的服务不是「空实现」
     * 而是 undefined，于是 ctx.slots.inject 直接抛 TypeError。写成 [] 的后果是
     * 面板与胶囊一个都不出现，而异常被 apply 自己的 try/catch 吞掉。
     */
    exports.inject = ["slots"];
    exports.name = "dsh-compact-line";
    return module.exports;
  }
});
