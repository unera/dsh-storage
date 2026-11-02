window.__ModuleLoader__.load({
  id: "@dr-co/dsh-storage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  StoragePage: () => StoragePage,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");

// client/locales.js
var NS = "dsh-storage";
var DICTIONARIES = {
  en: {
    "nav.title": "Storages",
    "intro": "Remote disks the model can read and write. One storage can be primary: it is used when a tool call names no id.",
    "empty": "No storages yet. Add one below.",
    "loading": "Loading\u2026",
    "add": "Add storage",
    "edit": "Edit",
    "editTitle": "Edit storage",
    "enabledLabel": "enabled",
    "readOnlyLabel": "read-only",
    "secretKeep": "leave empty to keep the current secret",
    "type": "Type",
    "label": "Name",
    "labelPlaceholder": "My files",
    "basePath": "Folder inside the storage",
    "basePathHint": "Optional, POSIX path. Empty means the storage root.",
    "root": "Directory on this host",
    "rootHint": "Absolute path, for example /srv/data",
    "bucket": "Bucket",
    "region": "Region",
    "endpoint": "Endpoint",
    "endpointHint": "Leave empty for AWS; set it for Yandex, Selectel, R2, MinIO",
    "secret": "Secret",
    "secretHint": 'JSON {"accessKeyId": "\u2026", "secretAccessKey": "\u2026"}. Stored in the credentials store, never in settings.',
    "secretSet": "secret is set",
    "save": "Save",
    "cancel": "Cancel",
    "test": "Check",
    "makePrimary": "Make primary",
    "primary": "primary",
    "remove": "Delete",
    "enabled": "on",
    "disabled": "off",
    "free": "free",
    "unknownFree": "free space unknown",
    "neverChecked": "not checked yet",
    "confirmRemove": "Delete this storage? Files stay where they are; only the entry goes away.",
    "saved": "saved",
    "failed": "failed"
  },
  ru: {
    "nav.title": "\u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430",
    "intro": "\u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0435 \u0434\u0438\u0441\u043A\u0438, \u043A\u0443\u0434\u0430 \u043C\u043E\u0434\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0447\u0438\u0442\u0430\u0442\u044C \u0438 \u043F\u0438\u0441\u0430\u0442\u044C. \u041E\u0434\u043D\u043E \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u043C: \u043E\u043D\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u0432 \u0432\u044B\u0437\u043E\u0432\u0435 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D id.",
    "empty": "\u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043D\u0438\u0436\u0435.",
    "loading": "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u2026",
    "add": "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435",
    "edit": "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C",
    "editTitle": "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435",
    "enabledLabel": "\u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E",
    "readOnlyLabel": "\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435",
    "secretKeep": "\u043E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043F\u0443\u0441\u0442\u044B\u043C, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u043A\u0440\u0435\u0442",
    "type": "\u0422\u0438\u043F",
    "label": "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435",
    "labelPlaceholder": "\u041C\u043E\u0438 \u0444\u0430\u0439\u043B\u044B",
    "basePath": "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u0432\u043D\u0443\u0442\u0440\u0438 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430",
    "basePathHint": "\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E, POSIX-\u043F\u0443\u0442\u044C. \u041F\u0443\u0441\u0442\u043E \u2014 \u043A\u043E\u0440\u0435\u043D\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0430.",
    "root": "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u043D\u0430 \u044D\u0442\u043E\u043C \u0445\u043E\u0441\u0442\u0435",
    "rootHint": "\u0410\u0431\u0441\u043E\u043B\u044E\u0442\u043D\u044B\u0439 \u043F\u0443\u0442\u044C, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 /srv/data",
    "bucket": "\u0411\u0430\u043A\u0435\u0442",
    "region": "\u0420\u0435\u0433\u0438\u043E\u043D",
    "endpoint": "Endpoint",
    "endpointHint": "\u041F\u0443\u0441\u0442\u043E \u0434\u043B\u044F AWS; \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0439\u0442\u0435 \u0434\u043B\u044F \u042F\u043D\u0434\u0435\u043A\u0441, Selectel, R2, MinIO",
    "secret": "\u0421\u0435\u043A\u0440\u0435\u0442",
    "secretHint": 'JSON {"accessKeyId": "\u2026", "secretAccessKey": "\u2026"}. \u041B\u0435\u0436\u0438\u0442 \u0432 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0441\u0435\u043A\u0440\u0435\u0442\u043E\u0432, \u043D\u0435 \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445.',
    "secretSet": "\u0441\u0435\u043A\u0440\u0435\u0442 \u0437\u0430\u0434\u0430\u043D",
    "save": "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    "cancel": "\u041E\u0442\u043C\u0435\u043D\u0430",
    "test": "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C",
    "makePrimary": "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u043C",
    "primary": "\u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0435",
    "remove": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
    "enabled": "\u0432\u043A\u043B",
    "disabled": "\u0432\u044B\u043A\u043B",
    "free": "\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E",
    "unknownFree": "\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0435 \u043C\u0435\u0441\u0442\u043E \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E",
    "neverChecked": "\u0435\u0449\u0451 \u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u043B\u043E\u0441\u044C",
    "confirmRemove": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435? \u0424\u0430\u0439\u043B\u044B \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u043D\u0430 \u043C\u0435\u0441\u0442\u0435, \u0438\u0441\u0447\u0435\u0437\u043D\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u043F\u0438\u0441\u044C.",
    "saved": "\u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
    "failed": "\u043E\u0448\u0438\u0431\u043A\u0430"
  }
};

// client/index.jsx
var SECTION_ID = "storage";
var API = "/__fs";
var TYPE_LABELS = {
  local: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u043D\u0430 \u044D\u0442\u043E\u043C \u0445\u043E\u0441\u0442\u0435",
  s3: "S3-\u0441\u043E\u0432\u043C\u0435\u0441\u0442\u0438\u043C\u044B\u0439",
  webdav: "WebDAV"
};
var styles = {
  intro: { opacity: 0.75, margin: "0 0 16px", lineHeight: 1.5 },
  table: { width: "100%", borderCollapse: "collapse", marginBottom: 16 },
  th: { textAlign: "left", padding: "6px 8px", opacity: 0.7, fontWeight: 600, borderBottom: "1px solid rgba(128,128,128,0.3)" },
  td: { padding: "8px", borderBottom: "1px solid rgba(128,128,128,0.15)", verticalAlign: "top" },
  badge: { display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 12, background: "rgba(128,128,128,0.2)", marginRight: 6 },
  ok: { background: "rgba(60,180,90,0.25)" },
  bad: { background: "rgba(220,80,70,0.25)" },
  button: { marginRight: 6, marginTop: 2, padding: "3px 8px", cursor: "pointer" },
  form: { border: "1px solid rgba(128,128,128,0.3)", borderRadius: 8, padding: 12, marginTop: 8 },
  row: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 220, flex: "1 1 220px" },
  input: { padding: "5px 7px" },
  hint: { opacity: 0.6, fontSize: 12 },
  error: { color: "#d05a4e", margin: "8px 0" },
  note: { opacity: 0.7, fontSize: 12, marginTop: 8 }
};
async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body === void 0 ? void 0 : JSON.stringify(options.body)
  });
  const text = await response.text();
  const body = text === "" ? {} : JSON.parse(text);
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}
function bytes(value) {
  if (typeof value !== "number") return null;
  const units = ["\u0411", "\u041A\u0438\u0411", "\u041C\u0438\u0411", "\u0413\u0438\u0411", "\u0422\u0438\u0411"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function StorageRow({ provider, t, onTest, onPrimary, onRemove, onEdit, busy }) {
  const stateTone = provider.status?.state === "ok" ? styles.ok : provider.status?.state === "unknown" ? {} : styles.bad;
  const free = bytes(provider.status?.freeBytes);
  return (0, import_jsx_runtime.jsx)("tr", {
    children: [
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: [
        (0, import_jsx_runtime.jsx)("strong", { children: provider.label }),
        (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: `${TYPE_LABELS[provider.type] ?? provider.type} \xB7 ${provider.id}${provider.basePath === "" ? "" : ` \xB7 ${provider.basePath}`}` }),
        provider.options?.root === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: provider.options.root }),
        provider.options?.baseUrl === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: provider.options.baseUrl }),
        provider.options?.bucket === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: `${provider.options.bucket}${provider.options.endpoint === void 0 ? "" : ` \xB7 ${provider.options.endpoint}`}` })
      ] }),
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: [
        (0, import_jsx_runtime.jsx)("span", { style: { ...styles.badge, ...stateTone }, children: provider.status?.state ?? "unknown" }),
        provider.status?.message === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: provider.status.message }),
        provider.secretConfigured ? (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: t("secretSet") }) : null
      ] }),
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: [
        provider.role === "primary" ? (0, import_jsx_runtime.jsx)("span", { style: { ...styles.badge, ...styles.ok }, children: t("primary") }) : null,
        (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: free === null ? t("unknownFree") : `${t("free")}: ${free}` })
      ] }),
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: [
        (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: () => onEdit(provider.id), children: t("edit") }),
        (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: () => onTest(provider.id), children: t("test") }),
        provider.role === "primary" ? null : (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: () => onPrimary(provider.id), children: t("makePrimary") }),
        (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: () => onRemove(provider.id), children: t("remove") })
      ] })
    ]
  });
}
function EntryForm({ types, t, first, initial, onCancel, onSaved }) {
  const editing = initial !== void 0;
  const [type, setType] = (0, import_react.useState)(initial?.type ?? types[0] ?? "local");
  const [label, setLabel] = (0, import_react.useState)(initial?.label ?? "");
  const [basePath, setBasePath] = (0, import_react.useState)(initial?.basePath ?? "");
  const [root, setRoot] = (0, import_react.useState)(initial?.options?.root ?? "");
  const [bucket, setBucket] = (0, import_react.useState)(initial?.options?.bucket ?? "");
  const [region, setRegion] = (0, import_react.useState)(initial?.options?.region ?? "");
  const [endpoint, setEndpoint] = (0, import_react.useState)(initial?.options?.endpoint ?? "");
  const [baseUrl, setBaseUrl] = (0, import_react.useState)(initial?.options?.baseUrl ?? "");
  const [secret, setSecret] = (0, import_react.useState)("");
  const [enabled, setEnabled] = (0, import_react.useState)(initial?.enabled !== false);
  const [readOnly, setReadOnly] = (0, import_react.useState)(initial?.readOnly === true);
  const autoPrimary = first === true;
  const [primary, setPrimary] = (0, import_react.useState)(initial?.role === "primary" || first === true);
  const [error, setError] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const optionsFor = () => {
    if (type === "local") return { root: root.trim() };
    if (type === "webdav") return { baseUrl: baseUrl.trim() };
    return { bucket: bucket.trim(), ...region.trim() === "" ? {} : { region: region.trim() }, ...endpoint.trim() === "" ? {} : { endpoint: endpoint.trim() } };
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        label: label.trim(),
        basePath: basePath.trim(),
        role: primary || autoPrimary ? "primary" : "secondary",
        enabled,
        readOnly,
        options: optionsFor(),
        ...secret.trim() === "" ? {} : { secret: secret.trim() }
      };
      if (editing) await request(`/providers/${initial.index}`, { method: "PATCH", body: payload });
      else await request("/providers", { method: "POST", body: { ...payload, type } });
      await onSaved();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };
  return (0, import_jsx_runtime.jsx)("div", { style: styles.form, children: [
    (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: t("type") }),
        (0, import_jsx_runtime.jsx)("select", { style: styles.input, value: type, disabled: editing, onChange: (event) => setType(event.target.value), children: types.map((item) => (0, import_jsx_runtime.jsx)("option", { value: item, children: TYPE_LABELS[item] ?? item }, item)) })
      ] }),
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: t("label") }),
        (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: label, placeholder: t("labelPlaceholder"), onChange: (event) => setLabel(event.target.value) })
      ] }),
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: t("basePath") }),
        (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: basePath, onChange: (event) => setBasePath(event.target.value) }),
        (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: t("basePathHint") })
      ] })
    ] }),
    type === "local" ? (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: t("root") }),
        (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: root, placeholder: "/srv/data", onChange: (event) => setRoot(event.target.value) }),
        (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: t("rootHint") })
      ] })
    ] }) : type === "webdav" ? (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: "baseUrl" }),
        (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: baseUrl, placeholder: "https://cloud.example/remote.php/dav/files/user", onChange: (event) => setBaseUrl(event.target.value) })
      ] })
    ] }) : (0, import_jsx_runtime.jsxs)("div", { children: [
      (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("bucket") }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: bucket, onChange: (event) => setBucket(event.target.value) })
        ] }),
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("region") }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: region, placeholder: "ru-central1", onChange: (event) => setRegion(event.target.value) })
        ] }),
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("endpoint") }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: endpoint, placeholder: "https://storage.yandexcloud.net", onChange: (event) => setEndpoint(event.target.value) }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: t("endpointHint") })
        ] })
      ] }),
      (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
        (0, import_jsx_runtime.jsx)("span", { children: t("secret") }),
        (0, import_jsx_runtime.jsx)("textarea", { style: { ...styles.input, minHeight: 60 }, value: secret, onChange: (event) => setSecret(event.target.value) }),
        (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: editing ? t("secretKeep") : t("secretHint") })
      ] })
    ] }),
    error === null ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.error, children: error }),
    (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 10 }, children: [
      (0, import_jsx_runtime.jsx)("label", { style: { marginRight: 12 }, children: [
        (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: primary || autoPrimary, disabled: autoPrimary, onChange: (event) => setPrimary(event.target.checked) }),
        ` ${t("primary")}`
      ] }),
      (0, import_jsx_runtime.jsx)("label", { style: { marginRight: 12 }, children: [
        (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
        ` ${t("enabledLabel")}`
      ] }),
      (0, import_jsx_runtime.jsx)("label", { style: { marginRight: 12 }, children: [
        (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: readOnly, onChange: (event) => setReadOnly(event.target.checked) }),
        ` ${t("readOnlyLabel")}`
      ] }),
      (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: submit, children: t("save") }),
      (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: onCancel, children: t("cancel") })
    ] })
  ] });
}
function StoragePage(props) {
  const t = typeof props?.t === "function" ? props.t : (key) => key;
  const [providers, setProviders] = (0, import_react.useState)([]);
  const [types, setTypes] = (0, import_react.useState)(["local"]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [adding, setAdding] = (0, import_react.useState)(false);
  const [editingId, setEditingId] = (0, import_react.useState)(null);
  const fetchOnce = async () => {
    const body = await request("/providers");
    const next = Array.isArray(body.providers) ? body.providers : [];
    if (Array.isArray(body.types) && body.types.length > 0) setTypes(body.types);
    setProviders(next);
    return next;
  };
  const load = async () => {
    setError(null);
    try {
      await fetchOnce();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setLoading(false);
    }
  };
  const reloadAfterWrite = async (expectedAtLeast) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const next = await fetchOnce();
        if (next.length >= expectedAtLeast) return;
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  (0, import_react.useEffect)(() => {
    load();
  }, []);
  const act = async (run) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reloadAfterWrite(providers.length);
    } catch (problem) {
      setError(problem.message);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const indexOf = (id) => providers.findIndex((provider) => provider.id === id);
  return (0, import_jsx_runtime.jsx)("div", { children: [
    (0, import_jsx_runtime.jsx)("p", { style: styles.intro, children: t("intro") }),
    loading ? (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("loading") }) : null,
    error === null ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.error, children: error }),
    providers.length === 0 && !loading ? (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("empty") }) : null,
    providers.length === 0 ? null : (0, import_jsx_runtime.jsx)("table", { style: styles.table, children: [
      (0, import_jsx_runtime.jsx)("thead", { children: (0, import_jsx_runtime.jsx)("tr", { children: [
        (0, import_jsx_runtime.jsx)("th", { style: styles.th, children: t("label") }),
        (0, import_jsx_runtime.jsx)("th", { style: styles.th, children: t("type") }),
        (0, import_jsx_runtime.jsx)("th", { style: styles.th, children: "" }),
        (0, import_jsx_runtime.jsx)("th", { style: styles.th, children: "" })
      ] }) }),
      (0, import_jsx_runtime.jsx)("tbody", { children: providers.map((provider) => (0, import_jsx_runtime.jsx)(StorageRow, {
        provider,
        t,
        busy,
        onTest: (id) => act(async () => {
          await request(`/providers/${indexOf(id)}/test`, { method: "POST" });
        }),
        onPrimary: (id) => act(async () => {
          await request(`/providers/${indexOf(id)}/primary`, { method: "POST" });
        }),
        onEdit: (id) => {
          setEditingId(id);
          setAdding(false);
        },
        onRemove: (id) => act(async () => {
          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("confirmRemove"))) return;
          await request(`/providers/${indexOf(id)}`, { method: "DELETE" });
        })
      }, provider.id)) })
    ] }),
    adding ? (0, import_jsx_runtime.jsx)(EntryForm, {
      types,
      t,
      first: providers.length === 0,
      onCancel: () => setAdding(false),
      onSaved: async () => {
        setAdding(false);
        await reloadAfterWrite(providers.length + 1);
      }
    }) : editingId === null ? (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy || loading, onClick: () => setAdding(true), children: t("add") }) : (0, import_jsx_runtime.jsx)(EntryForm, {
      types,
      t,
      initial: (() => {
        const provider = providers.find((item) => item.id === editingId);
        return provider === void 0 ? void 0 : { ...provider, index: providers.indexOf(provider) };
      })(),
      onCancel: () => setEditingId(null),
      onSaved: async () => {
        setEditingId(null);
        await reloadAfterWrite(providers.length);
      }
    }),
    (0, import_jsx_runtime.jsx)("p", { style: styles.note, children: "API: /__fs" })
  ] });
}
function apply(ctx) {
  let t = (key) => key;
  try {
    t = ctx.locale.bind(NS);
  } catch (error) {
    console.warn(`[dsh-storage] locale unavailable: ${error?.message ?? error}`);
  }
  try {
    ctx.effect(() => {
      ctx.locale.register(NS, "en", DICTIONARIES.en);
      ctx.locale.register(NS, "ru", DICTIONARIES.ru);
      return () => {
      };
    }, "dsh-storage: dictionaries");
  } catch (error) {
    console.warn(`[dsh-storage] dictionaries failed: ${error?.message ?? error}`);
  }
  try {
    ctx.effect(() => {
      try {
        return ctx.locale.addLanguage("ru");
      } catch (error) {
        if (!/already/i.test(String(error?.message ?? error))) throw error;
        return () => {
        };
      }
    }, "dsh-storage: ru language");
  } catch (error) {
    console.warn(`[dsh-storage] ru language failed: ${error?.message ?? error}`);
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: SECTION_ID,
    order: 36,
    locale: NS,
    label: () => t("nav.title")
  }, StoragePage));
}
var inject = ["slots", "locale"];

    return module.exports;
  }
});
