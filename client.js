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
    "hintUnknownState": 'Press "Check" to test this storage',
    "hintRead": "read",
    "hintWrite": "write",
    "hintDelete": "delete",
    "hintFree": "free space",
    "hintFreeUnknown": "the storage does not report free space",
    "login": "Login",
    "password": "Password",
    "passwordHint": "App password is better than the account password",
    "clientId": "Application id",
    "clientIdHint": "From the app registered at oauth.yandex.ru",
    "clientSecret": "Application secret",
    "clientSecretHint": "The app secret from oauth.yandex.com; it stays in the credential store",
    "clientIdNeeded": "This button needs the application id: Yandex will not hand out a device code without it. Register an app at oauth.yandex.com, copy its ClientID into the field above, and press again.",
    "token": "OAuth token",
    "deviceConnect": "Connect with a code",
    "deviceCode": "Code",
    "deviceOpen": "Enter this code on the page:",
    "deviceOpenButton": "Open the page",
    "deviceCopy": "Copy the code to the clipboard",
    "deviceCopied": "copied",
    "deviceWaiting": "Waiting for confirmation\u2026",
    "deviceDone": "Connected. The token is stored on the host and never shown \u2014 press Check to confirm access.",
    "deviceSaveFirst": "Save the storage first, then connect it by code",
    "tokenHint": "Paste a token if you already have one; otherwise use the code above",
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
    "secretSet": "token is set",
    "clientSecretSet": "application secret is set",
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
    "hintUnknownState": "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C\xBB, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0442\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
    "hintRead": "\u0447\u0442\u0435\u043D\u0438\u0435",
    "hintWrite": "\u0437\u0430\u043F\u0438\u0441\u044C",
    "hintDelete": "\u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435",
    "hintFree": "\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0435 \u043C\u0435\u0441\u0442\u043E",
    "hintFreeUnknown": "\u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043D\u0435 \u0441\u043E\u043E\u0431\u0449\u0430\u0435\u0442 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0435 \u043C\u0435\u0441\u0442\u043E",
    "login": "\u041B\u043E\u0433\u0438\u043D",
    "password": "\u041F\u0430\u0440\u043E\u043B\u044C",
    "passwordHint": "\u041B\u0443\u0447\u0448\u0435 \u043F\u0430\u0440\u043E\u043B\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F, \u0447\u0435\u043C \u043F\u0430\u0440\u043E\u043B\u044C \u043E\u0442 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430",
    "clientId": "\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
    "clientIdHint": "\u0418\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F, \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u043D\u0430 oauth.yandex.ru",
    "clientSecret": "\u0421\u0435\u043A\u0440\u0435\u0442 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
    "clientSecretHint": "Secret \u0438\u0437 \u0441\u0432\u043E\u0439\u0441\u0442\u0432 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u043D\u0430 oauth.yandex.com; \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0441\u0435\u043A\u0440\u0435\u0442\u043E\u0432",
    "clientIdNeeded": "\u041A\u043D\u043E\u043F\u043A\u0435 \u043D\u0443\u0436\u0435\u043D \u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F: \u0431\u0435\u0437 \u043D\u0435\u0433\u043E \u042F\u043D\u0434\u0435\u043A\u0441 \u043D\u0435 \u0432\u044B\u0434\u0430\u0451\u0442 \u043A\u043E\u0434 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430. \u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439\u0442\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043D\u0430 oauth.yandex.com, \u0432\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0435\u0433\u043E ClientID \u0432 \u043F\u043E\u043B\u0435 \u0432\u044B\u0448\u0435 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u0441\u043D\u043E\u0432\u0430.",
    "token": "OAuth-\u0442\u043E\u043A\u0435\u043D",
    "deviceConnect": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u043E \u043A\u043E\u0434\u0443",
    "deviceCode": "\u041A\u043E\u0434",
    "deviceOpen": "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u044D\u0442\u043E\u0442 \u043A\u043E\u0434 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435:",
    "deviceOpenButton": "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443",
    "deviceCopy": "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u0434 \u0432 \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430",
    "deviceCopied": "\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
    "deviceWaiting": "\u0416\u0434\u0451\u043C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F\u2026",
    "deviceDone": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E. \u0422\u043E\u043A\u0435\u043D \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u043D\u0430 \u0445\u043E\u0441\u0442\u0435 \u0438 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u2014 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C\xBB, \u0447\u0442\u043E\u0431\u044B \u0443\u0431\u0435\u0434\u0438\u0442\u044C\u0441\u044F.",
    "deviceSaveFirst": "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435, \u043F\u043E\u0442\u043E\u043C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0439\u0442\u0435 \u043F\u043E \u043A\u043E\u0434\u0443",
    "tokenHint": "\u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0442\u043E\u043A\u0435\u043D, \u0435\u0441\u043B\u0438 \u043E\u043D \u0443 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C; \u0438\u043D\u0430\u0447\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u043A\u043E\u0434 \u0432\u044B\u0448\u0435",
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
    "secretSet": "\u0442\u043E\u043A\u0435\u043D \u0437\u0430\u0434\u0430\u043D",
    "clientSecretSet": "\u0441\u0435\u043A\u0440\u0435\u0442 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0437\u0430\u0434\u0430\u043D",
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
  webdav: "WebDAV",
  yadisk: "\u042F\u043D\u0434\u0435\u043A\u0441.\u0414\u0438\u0441\u043A"
};
var ICONS = {
  local: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8aa0b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'),
  s3: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e0a23c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>'),
  webdav: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5aa9e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a4 4 0 0 0 .6-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 .5 7z"/></svg>'),
  yadisk: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fc3f1d"/><path d="M9 18V9.2c0-2 1.3-3.2 3.3-3.2H15v2.4h-2.2c-.8 0-1.2.4-1.2 1.2V11l3.6 7h-2.7l-3-6v6z" fill="#fff"/></svg>'),
  edit: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/></svg>'),
  save: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>'),
  copy: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>'),
  cancel: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'),
  test: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/></svg>'),
  primary: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.9 5.9 6.1.9-4.4 4.3 1 6.4-5.6-3-5.6 3 1-6.4L3 9.8l6.1-.9z"/></svg>'),
  remove: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>')
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
  square: { width: 28, height: 28, padding: 0, marginRight: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: 6 },
  icon: { width: 16, height: 16, display: "block" },
  typeIcon: { width: 22, height: 22, marginRight: 8, flex: "0 0 auto" },
  nameCell: { display: "flex", alignItems: "flex-start", gap: 12 },
  badges: { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", maxWidth: 190 },
  buttonColumn: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" },
  iconColumn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: "0 0 auto" },
  // The primary mark doubles as the switch: a star that is grey until the entry
  // is the default target, and green once it is.
  starPill: { display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 18, padding: 0, borderRadius: 9, border: "none" },
  starOn: { background: "rgba(60,180,90,0.45)" },
  starOff: { background: "rgba(128,128,128,0.25)" },
  // No `cursor: help`: a question-mark pointer on a small pill reads as a puzzle
  // rather than as a tooltip, and the hint appears on hover anyway.
  pill: { display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 12, whiteSpace: "nowrap" },
  pillOk: { background: "rgba(60,180,90,0.28)" },
  pillGrey: { background: "rgba(128,128,128,0.28)" },
  pillBad: { background: "rgba(220,80,70,0.28)" },
  pillFree: { background: "rgba(70,130,220,0.30)" },
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
function LineField({ value, onChange, placeholder, spellCheck = false }) {
  return (0, import_jsx_runtime.jsx)("textarea", {
    rows: 1,
    value,
    placeholder,
    spellCheck,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    onChange: (event) => onChange(event.target.value),
    style: { ...styles.input, height: 30, minHeight: 30, resize: "none", overflow: "hidden", whiteSpace: "pre", fontFamily: "inherit" }
  });
}
function IconButton({ icon, title, onClick, disabled, tone }) {
  return (0, import_jsx_runtime.jsx)("button", {
    style: { ...styles.square, ...tone === void 0 ? {} : tone },
    title,
    "aria-label": title,
    disabled,
    onClick,
    children: (0, import_jsx_runtime.jsx)("img", { src: ICONS[icon], alt: "", style: styles.icon })
  });
}
function Pill({ children, tone, hint }) {
  return (0, import_jsx_runtime.jsx)("span", { style: { ...styles.pill, ...tone }, title: hint, children });
}
function StorageRow({ provider, capabilities, t, onTest, onPrimary, onRemove, onEdit, busy }) {
  const state = provider.status?.state ?? "unknown";
  const stateTone = state === "ok" ? styles.pillOk : state === "unknown" ? styles.pillGrey : styles.pillBad;
  const stateHint = state === "unknown" ? t("hintUnknownState") : provider.status?.message ?? state;
  const caps = capabilities?.[provider.type] ?? {};
  const free = bytes(provider.status?.freeBytes);
  const permission = (letter, allowed, hint) => (0, import_jsx_runtime.jsx)(Pill, { tone: allowed ? styles.pillOk : styles.pillBad, hint, children: letter });
  return (0, import_jsx_runtime.jsx)("tr", {
    children: [
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: (0, import_jsx_runtime.jsx)("div", { style: styles.nameCell, children: [
        (0, import_jsx_runtime.jsx)("div", { style: styles.iconColumn, children: [
          (0, import_jsx_runtime.jsx)("img", { src: ICONS[provider.type], alt: "", style: { ...styles.typeIcon, marginRight: 0 } }),
          (0, import_jsx_runtime.jsx)("button", {
            style: { ...styles.starPill, ...provider.role === "primary" ? styles.starOn : styles.starOff, cursor: provider.role === "primary" ? "default" : "pointer" },
            title: provider.role === "primary" ? t("primary") : t("makePrimary"),
            "aria-label": provider.role === "primary" ? t("primary") : t("makePrimary"),
            disabled: busy || provider.role === "primary",
            onClick: () => onPrimary(provider.id),
            children: (0, import_jsx_runtime.jsx)("img", { src: ICONS.primary, alt: "", style: { width: 12, height: 12, display: "block" } })
          })
        ] }),
        (0, import_jsx_runtime.jsx)("div", { children: [
          (0, import_jsx_runtime.jsx)("strong", { children: provider.label }),
          (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: `${TYPE_LABELS[provider.type] ?? provider.type} \xB7 ${provider.id}${provider.role === "primary" ? ` \xB7 ${t("primary")}` : ""}` }),
          provider.options?.root === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: provider.options.root }),
          provider.options?.baseUrl === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: provider.options.baseUrl }),
          provider.options?.bucket === void 0 ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.hint, children: `${provider.options.bucket}${provider.options.endpoint === void 0 ? "" : ` \xB7 ${provider.options.endpoint}`}` })
        ] })
      ] }) }),
      (0, import_jsx_runtime.jsx)("td", { style: styles.td, children: (0, import_jsx_runtime.jsx)("div", { style: styles.badges, children: [
        (0, import_jsx_runtime.jsx)(Pill, { tone: stateTone, hint: stateHint, children: state === "unknown" ? "?" : state }),
        permission("R", caps.get === true, t("hintRead")),
        permission("W", caps.put === true, t("hintWrite")),
        permission("D", caps.delete === true, t("hintDelete")),
        free === null ? (0, import_jsx_runtime.jsx)(Pill, { tone: styles.pillGrey, hint: t("hintFreeUnknown"), children: "\u2014" }) : (0, import_jsx_runtime.jsx)(Pill, { tone: styles.pillFree, hint: t("hintFree"), children: free })
      ] }) }),
      (0, import_jsx_runtime.jsx)("td", { style: { ...styles.td, whiteSpace: "nowrap", verticalAlign: "top" }, children: (0, import_jsx_runtime.jsx)("div", { style: styles.buttonColumn, children: [
        (0, import_jsx_runtime.jsx)(IconButton, {
          icon: "edit",
          title: t("edit"),
          disabled: busy,
          onClick: () => onEdit(provider.id)
        }),
        (0, import_jsx_runtime.jsx)(IconButton, {
          icon: "test",
          title: t("test"),
          disabled: busy,
          onClick: () => onTest(provider.id)
        }),
        (0, import_jsx_runtime.jsx)(IconButton, {
          icon: "remove",
          title: t("remove"),
          disabled: busy,
          onClick: () => onRemove(provider.id)
        })
      ] }) })
    ]
  });
}
function EntryForm({ types, t, first, initial, onCancel, onSaved, onRefresh }) {
  const editing = initial !== void 0;
  const [entryId] = (0, import_react.useState)(() => initial?.id ?? `st-${Math.random().toString(36).slice(2, 6)}`);
  const [type, setType] = (0, import_react.useState)(initial?.type ?? types[0] ?? "local");
  const [label, setLabel] = (0, import_react.useState)(initial?.label ?? "");
  const [basePath, setBasePath] = (0, import_react.useState)(initial?.basePath ?? "");
  const [root, setRoot] = (0, import_react.useState)(initial?.options?.root ?? "");
  const [bucket, setBucket] = (0, import_react.useState)(initial?.options?.bucket ?? "");
  const [region, setRegion] = (0, import_react.useState)(initial?.options?.region ?? "");
  const [endpoint, setEndpoint] = (0, import_react.useState)(initial?.options?.endpoint ?? "");
  const [baseUrl, setBaseUrl] = (0, import_react.useState)(initial?.options?.baseUrl ?? "");
  const [username, setUsername] = (0, import_react.useState)("");
  const [password, setPassword] = (0, import_react.useState)("");
  const [clientId, setClientId] = (0, import_react.useState)(initial?.options?.clientId ?? "");
  const [clientSecret, setClientSecret] = (0, import_react.useState)("");
  const [token, setToken] = (0, import_react.useState)("");
  const [device, setDevice] = (0, import_react.useState)(null);
  const [copied, setCopied] = (0, import_react.useState)(false);
  const copyCode = async (value) => {
    try {
      if (navigator?.clipboard?.writeText !== void 0) await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch {
      setCopied(false);
    }
  };
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
    if (type === "yadisk") return { ...clientId.trim() === "" ? {} : { clientId: clientId.trim() } };
    return { bucket: bucket.trim(), ...region.trim() === "" ? {} : { region: region.trim() }, ...endpoint.trim() === "" ? {} : { endpoint: endpoint.trim() } };
  };
  const secretFor = () => {
    if (type === "webdav") {
      if (username.trim() === "" && password.trim() === "") return void 0;
      return JSON.stringify({ username: username.trim(), password: password.trim() });
    }
    if (type === "yadisk") return token.trim() === "" ? void 0 : token.trim();
    return secret.trim() === "" ? void 0 : secret.trim();
  };
  const deviceReady = true;
  const deviceBlockedReason = clientId.trim() === "" ? t("clientIdNeeded") : "";
  const startDevice = async () => {
    setError(null);
    if (clientId.trim() === "") {
      setError(t("clientIdNeeded"));
      return;
    }
    try {
      const started = await request("/auth/device/start", { method: "POST", body: { id: entryId, clientId: clientId.trim(), type } });
      setDevice({ userCode: started.userCode, verificationUrl: started.verificationUrl, status: "waiting" });
      const intervalMs = Math.max(1e3, Number(started.interval ?? 5) * 1e3);
      const deadline = Date.now() + Math.max(30, Number(started.expiresIn ?? 300)) * 1e3;
      const poll = async () => {
        if (Date.now() > deadline) {
          setDevice((current) => current === null ? null : { ...current, status: "error", error: "\u043A\u043E\u0434 \u0438\u0441\u0442\u0451\u043A" });
          return;
        }
        try {
          const answer = await request("/auth/device/poll", { method: "POST", body: { state: started.state } });
          if (answer.status === "ok") {
            setDevice((current) => current === null ? null : { ...current, status: "ok" });
            setToken("");
            if (typeof onRefresh === "function") await onRefresh();
            return;
          }
          if (answer.status === "pending") {
            setTimeout(poll, intervalMs);
            return;
          }
          setDevice((current) => current === null ? null : { ...current, status: "error", error: answer.error ?? answer.status });
        } catch (problem) {
          setDevice((current) => current === null ? null : { ...current, status: "error", error: problem.message });
        }
      };
      setTimeout(poll, intervalMs);
    } catch (problem) {
      setError(problem.message);
    }
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
        ...secretFor() === void 0 ? {} : { secret: secretFor() },
        ...clientSecret.trim() === "" ? {} : { clientSecret: clientSecret.trim() }
      };
      if (editing) await request(`/providers/${initial.index}`, { method: "PATCH", body: payload });
      else await request("/providers", { method: "POST", body: { ...payload, type, id: entryId } });
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
    ] }) : type === "webdav" ? (0, import_jsx_runtime.jsxs)("div", { children: [
      (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: "baseUrl" }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: baseUrl, placeholder: "https://cloud.example/remote.php/dav/files/user", onChange: (event) => setBaseUrl(event.target.value) })
        ] })
      ] }),
      (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("login") }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, value: username, autoComplete: "off", onChange: (event) => setUsername(event.target.value) })
        ] }),
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("password") }),
          (0, import_jsx_runtime.jsx)("input", { style: styles.input, type: "password", value: password, autoComplete: "new-password", onChange: (event) => setPassword(event.target.value) }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: editing ? t("secretKeep") : t("passwordHint") })
        ] })
      ] })
    ] }) : type === "yadisk" ? (0, import_jsx_runtime.jsxs)("div", { children: [
      (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: [
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("clientId") }),
          (0, import_jsx_runtime.jsx)(LineField, { value: clientId, placeholder: "\u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F", onChange: setClientId }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: t("clientIdHint") })
        ] }),
        (0, import_jsx_runtime.jsx)("label", { style: styles.field, children: [
          (0, import_jsx_runtime.jsx)("span", { children: t("clientSecret") }),
          (0, import_jsx_runtime.jsx)(LineField, { value: clientSecret, onChange: setClientSecret }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: editing ? t("secretKeep") : t("clientSecretHint") })
        ] })
      ] }),
      (0, import_jsx_runtime.jsx)("div", { style: { margin: "4px 0 12px" }, children: [
        (0, import_jsx_runtime.jsx)("button", {
          style: styles.button,
          disabled: busy || !deviceReady || device?.status === "waiting",
          title: deviceReady ? t("deviceConnect") : deviceBlockedReason,
          onClick: startDevice,
          children: t("deviceConnect")
        }),
        // Why the button does nothing, in words instead of a tooltip: a greyed
        // button with a hidden reason reads as broken.
        deviceReady ? null : (0, import_jsx_runtime.jsx)("div", { style: { ...styles.hint, marginTop: 4 }, children: deviceBlockedReason }),
        device === null ? null : (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }, children: [
          (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 20, letterSpacing: 3, fontFamily: "monospace" }, children: device.userCode }),
          (0, import_jsx_runtime.jsx)(IconButton, {
            icon: "copy",
            title: t("deviceCopy"),
            onClick: () => copyCode(device.userCode)
          }),
          (0, import_jsx_runtime.jsx)("button", {
            style: styles.button,
            onClick: () => window.open(device.verificationUrl, "_blank", "noopener"),
            children: t("deviceOpenButton")
          }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: copied ? t("deviceCopied") : t("deviceOpen") }),
          (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: device.status === "ok" ? t("deviceDone") : device.status === "error" ? `${t("failed")}: ${device.error}` : t("deviceWaiting") })
        ] })
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
      ] })
    ] }),
    (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 12, display: "flex", gap: 8 }, children: [
      (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: submit, children: [
        (0, import_jsx_runtime.jsx)("img", { src: ICONS.save, alt: "", style: { ...styles.icon, display: "inline-block", verticalAlign: "-3px", marginRight: 6 } }),
        t("save")
      ] }),
      (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy, onClick: onCancel, children: [
        (0, import_jsx_runtime.jsx)("img", { src: ICONS.cancel, alt: "", style: { ...styles.icon, display: "inline-block", verticalAlign: "-3px", marginRight: 6 } }),
        t("cancel")
      ] })
    ] })
  ] });
}
function StoragePage(props) {
  const t = typeof props?.t === "function" ? props.t : (key) => key;
  const [providers, setProviders] = (0, import_react.useState)([]);
  const [types, setTypes] = (0, import_react.useState)(["local"]);
  const [capabilities, setCapabilities] = (0, import_react.useState)({});
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [adding, setAdding] = (0, import_react.useState)(false);
  const [editingId, setEditingId] = (0, import_react.useState)(null);
  const peek = async () => {
    const body = await request("/providers");
    const next = Array.isArray(body.providers) ? body.providers : [];
    if (Array.isArray(body.types) && body.types.length > 0) setTypes(body.types);
    if (body.capabilities !== void 0 && body.capabilities !== null) setCapabilities(body.capabilities);
    return next;
  };
  const fetchOnce = async () => {
    const next = await peek();
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
  const act = async (run, { optimistic, until } = {}) => {
    if (typeof optimistic === "function") setProviders((previous) => optimistic(previous));
    setBusy(true);
    setError(null);
    try {
      await run();
      let last;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        last = await peek();
        if (until === void 0 || until(last) === true) {
          setProviders(last);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (last !== void 0) setProviders(last);
    } catch (problem) {
      setError(problem.message);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const indexOf = (id) => providers.findIndex((provider) => provider.id === id);
  const form = adding ? { key: "new" } : editingId === null ? null : (() => {
    const provider = providers.find((item) => item.id === editingId);
    return provider === void 0 ? null : { key: provider.id, initial: { ...provider, index: providers.indexOf(provider) } };
  })();
  return (0, import_jsx_runtime.jsx)("div", { children: [
    (0, import_jsx_runtime.jsx)("p", { style: styles.intro, children: t("intro") }),
    loading ? (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("loading") }) : null,
    error === null ? null : (0, import_jsx_runtime.jsx)("div", { style: styles.error, children: error }),
    form === null ? (0, import_jsx_runtime.jsx)("button", { style: styles.button, disabled: busy || loading, onClick: () => {
      setAdding(true);
      setEditingId(null);
    }, children: t("add") }) : (0, import_jsx_runtime.jsx)(EntryForm, {
      key: form.key,
      types,
      t,
      first: providers.length === 0 && form.initial === void 0,
      initial: form.initial,
      onRefresh: load,
      onCancel: () => {
        setAdding(false);
        setEditingId(null);
      },
      onSaved: async () => {
        const wasEditing = form.initial !== void 0;
        setAdding(false);
        setEditingId(null);
        await reloadAfterWrite(wasEditing ? providers.length : providers.length + 1);
      }
    }),
    providers.length === 0 && !loading ? (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: t("empty") }) : null,
    providers.length === 0 ? null : (0, import_jsx_runtime.jsx)("table", { style: styles.table, children: [
      (0, import_jsx_runtime.jsx)("thead", { children: (0, import_jsx_runtime.jsx)("tr", { children: [
        (0, import_jsx_runtime.jsx)("th", { style: { ...styles.th, width: "100%" }, children: t("label") }),
        (0, import_jsx_runtime.jsx)("th", { style: { ...styles.th, whiteSpace: "nowrap" }, children: "" }),
        (0, import_jsx_runtime.jsx)("th", { style: { ...styles.th, whiteSpace: "nowrap" }, children: "" })
      ] }) }),
      (0, import_jsx_runtime.jsx)("tbody", { children: providers.map((provider) => (0, import_jsx_runtime.jsx)(StorageRow, {
        provider,
        capabilities,
        t,
        busy,
        onTest: (id) => {
          const before = providers.find((item) => item.id === id)?.status?.checkedAt ?? null;
          return act(
            async () => {
              await request(`/providers/${indexOf(id)}/test`, { method: "POST" });
            },
            { until: (next) => (next.find((item) => item.id === id)?.status?.checkedAt ?? null) !== before }
          );
        },
        onPrimary: (id) => act(
          async () => {
            await request(`/providers/${indexOf(id)}/primary`, { method: "POST" });
          },
          {
            // Show the switch immediately; the loop only waits for confirmation.
            optimistic: (previous) => previous.map((item) => ({ ...item, role: item.id === id ? "primary" : "secondary" })),
            until: (next) => next.find((item) => item.id === id)?.role === "primary"
          }
        ),
        onEdit: (id) => {
          setEditingId(id);
          setAdding(false);
        },
        onRemove: (id) => {
          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("confirmRemove"))) return;
          return act(
            async () => {
              await request(`/providers/${indexOf(id)}`, { method: "DELETE" });
            },
            {
              optimistic: (previous) => previous.filter((item) => item.id !== id),
              until: (next) => next.every((item) => item.id !== id)
            }
          );
        }
      }, provider.id)) })
    ] })
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
        return ctx.locale.addLanguage({ id: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", fallback: "en" });
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
