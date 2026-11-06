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
      /* token 全部取自 @deepseek-ai/dsh-client-ui-theme 实际定义的集合。
         名字写错不会报错，只会静默落到 var() 回退值上 —— 在 liquid-glass
         下就是一块和壁纸对不上的硬灰。测试里锁了白名单。 */
      ".dcl-root{display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
      ".dcl-row{display:flex;align-items:center;gap:6px}",
      ".dcl-spacer{flex:1 1 0;min-width:0}",
      ".dcl-unit{flex:none;color:var(--dsw-alias-label-tertiary)}",

      /* 输入框宽度按内容收；flex:none 防止被同行按钮挤压。 */
      ".dcl-input{box-sizing:border-box;flex:none;field-sizing:content;min-width:56px;font:inherit;font-variant-numeric:tabular-nums;padding:3px 8px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);outline:none}",
      ".dcl-input:focus-visible{border-color:var(--dsw-alias-label-tertiary)}",
      ".dcl-input:disabled{opacity:.5}",

      /* 按钮必须 nowrap + flex:none：弹层窄，默认的 flex-shrink 会把「刷新」
         压成两行。这是上一版的真实故障。 */
      ".dcl-btn{flex:none;white-space:nowrap;font:inherit;padding:3px 7px;border-radius:var(--dsw-radius-sm);cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);transition:background-color .12s ease}",
      ".dcl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dcl-btn:disabled{opacity:.45;cursor:default}",
      ".dcl-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}",
      ".dcl-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
      ".dcl-btn-ghost{color:var(--dsw-alias-label-tertiary);padding:3px 4px}",

      ".dcl-hint{flex:none;white-space:nowrap;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
      /* 说明单独占一行：和两个按钮挤在一行时，右边缘会顶到关闭按钮。 */
      ".dcl-note{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}",
      ".dcl-error{font-size:11px;line-height:16px;max-width:150px;color:var(--dsw-alias-state-error-primary)}",
      ".dcl-ok{font-size:11px;line-height:16px;max-width:150px;color:var(--dsw-alias-state-success-primary)}",

      ".dcl-table{width:100%;border-collapse:collapse;font-size:12px}",
      ".dcl-table th{text-align:left;font-weight:400;color:var(--dsw-alias-label-tertiary);padding:0 8px 4px 0}",
      ".dcl-table td{text-align:left;padding:4px 8px 4px 0;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}",
      ".dcl-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",

      /* 读数胶囊：逐条对齐 ui-chat 的 StatsPills（.bOPqQW_*）。 */
      ".dcl-anchor{position:relative;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}",
      ".dcl-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}",
      ".dcl-pill:hover,.dcl-pill[data-open=\"1\"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",

      /* 弹层：对齐 ContextMeter 的 .JObwrW_panel。--dsw-elevation-stroke-color
         是 liquid-glass 画玻璃边缘用的，漏了它面板就只剩阴影。
         宽度按内容定：输入行 96+8+40+8+48 + 关闭按钮避让 22 + 内边距 24 ≈ 272。 */
      ".dcl-pop{position:absolute;left:0;bottom:calc(100% + 8px);z-index:1100;box-sizing:border-box;width:max-content;max-width:min(100vw - 24px,100%);padding:10px 12px;border-radius:var(--dsw-radius-lg);border:0;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;text-align:left}",
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
     * 从 /state 里读出胶囊该显示什么。只返回一段文字 —— 面板里不再有副标题。
     *
     * 优先级：插件上次写入的记录 > 预设里真实的比例（比例 × 参考窗口只在两者
     * 都有时才可信）。都没有就如实说「默认」，不编一个数字出来。
     */
    function summarize(state) {
      if (state === undefined) return { label: "读取中" };
      if (state.error !== undefined) return { label: "读取失败" };
      const presets = Array.isArray(state.presets) ? state.presets : [];
      const live = presets.filter((preset) => preset.present === true);
      const applied = state.lastApplied;
      if (applied !== undefined && applied.plan !== undefined && typeof applied.plan.thresholdTokens === "number") {
        return { label: formatTokens(applied.plan.thresholdTokens) };
      }
      if (live.length === 0) return { label: "无预设" };
      if (live.every((preset) => preset.thresholdRatio === undefined)) return { label: "默认" };
      const ratios = live.map((preset) => preset.thresholdRatio);
      const same = ratios.every((ratio) => ratio === ratios[0]);
      // 拿得到参考窗口、且各预设比例一致时，折算回绝对 token 数 —— 这样重启后
      // （lastApplied 已清空）胶囊仍显示「25万」而不是「比例 0.25」。窗口读不到
      // 就老实显示比例，用兜底窗口折算会得到一个很像、其实不对的数。
      const window = state.referenceWindow;
      if (same && typeof window === "number" && Number.isFinite(window) && window > 0) {
        return { label: formatTokens(Math.round(ratios[0] * window)) };
      }
      return { label: same ? "比例 " + ratios[0] : "比例 每模型不同" };
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
        // 三行：输入+tokens / 三个按钮 / 一句说明。
        h(
          "div",
          { className: "dcl-row" },
          h("input", {
            className: "dcl-input",
            type: "number",
            min: 1000,
            step: 1000,
            value: threshold,
            disabled: busy,
            "aria-label": "压缩线（tokens）",
            title: "压到这条线就压缩一次，压完保留这条线的一半",
            onChange: touch(setThreshold)
          }),
          h("span", { className: "dcl-unit" }, "tokens")
        ),
        h(
          "div",
          { className: "dcl-row" },
          h("button", { className: "dcl-btn dcl-btn-primary", type: "button", onClick: submit, disabled: busy }, busy ? "写入中…" : "应用"),
          h("button", { className: "dcl-btn dcl-btn-ghost", type: "button", onClick: props.onRefresh, disabled: busy }, "刷新"),
          h("button", { className: "dcl-btn dcl-btn-ghost", type: "button", onClick: reset, disabled: busy }, "恢复默认")
        ),
        h("div", { className: "dcl-note" }, "压完保留这条线的一半"),
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
        h(CompactLineForm, { state: state, onRefresh: refresh, onChanged: refresh }),
        h(
          "table",
          { className: "dcl-table" },
          h("thead", null, h("tr", null, h("th", null, "预设"), h("th", null, "压缩线"))),
          h(
            "tbody",
            null,
            rows.map((row) =>
              h(
                "tr",
                { key: row.preset.presetId },
                h("td", null, row.preset.presetId),
                h("td", { className: "dcl-num" }, row.preset.present === true && row.implied !== undefined ? row.implied.toLocaleString() : "—")
              )
            ),
            rows.length === 0 ? h("tr", null, h("td", { colSpan: 2, className: "dcl-hint" }, "没有读到预设")) : null
          )
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
            title: "压缩线 " + summary.label + "，点击调整",
            "data-open": open ? "1" : "0",
            onClick: () => setOpen(!open)
          },
          "压缩线 " + summary.label
        ),
        open
          ? h(
              "div",
              { className: "dcl-pop", role: "dialog", "aria-label": "压缩线设置" },
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
